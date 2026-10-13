import * as React from 'react'
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  FRAMES,
  MAX_SCORE,
  MIN_SCORE,
  MODEL_TIERS,
  SCORE_COUNT,
  STAGES,
  buildLadder,
  firstFrameOfStage,
  formatSignedScore,
  frameIndexFor,
  scoreOfFrame,
  stageIndexFor,
} from './levels.js'
import {
  NAME_MAX_LENGTH,
  displayNameAt,
  nameRuns,
  normalizeNames,
  visibleRuns,
} from './labels.js'
import {
  IMAGES_KEY,
  compressImageFile,
  galleryGC,
  galleryGet,
  galleryPut,
  imageFileId,
} from './gallery.js'
import { styles } from './styles.js'

/**
 * 客户端硬依赖。
 *
 * `remote` 与 `remote.session` 是必须的，虽然插件自己不直接调用它们：
 * Cordis 的 Service 代理会把 `this.ctx` 绑定到**调用方**的上下文，而
 * `ctx.modelDirectories.directoryFor()` 内部要读 `this.ctx.remote.session`。
 * 调用方没声明这两个服务时，守卫会抛
 * `cannot get property "remote.session" without inject` —— 目录永远拿不到，
 * 滑杆就会一直停在「模型目录未就绪」。
 */
export const inject = ['modelDirectories', 'remote', 'remote.session', 'sessions', 'slots']

/** 滑动结束后背景图停留时间与淡出时长。 */
const WALLPAPER_HIDE_MS = 5000
const WALLPAPER_FADE_MS = 320
const ERROR_KEY = 'liang-calibrator:errors'
const OVERRIDE_KEY = 'liang-calibrator:stages'
const NAMES_KEY = 'liang-calibrator:names'
const MAX_ERRORS = 8
const POPOVER_WIDTH = 408

const EMPTY_SNAPSHOT = Object.freeze({
  current: null, routable: null, groups: [], failures: [], status: 'idle', pending: null, error: null,
})
const EMPTY_STORE = Object.freeze({ getSnapshot: () => EMPTY_SNAPSHOT, subscribe: () => () => {} })

/* ------------------------------- 诊断 ------------------------------- */

function pushRecord(entry) {
  try {
    const raw = window.localStorage.getItem(ERROR_KEY)
    const parsed = raw === null ? [] : JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : []
    window.localStorage.setItem(ERROR_KEY, JSON.stringify([...list, entry].slice(-MAX_ERRORS)))
  } catch {
    // 记录失败只影响诊断。
  }
}

/** 记录一次插件相关错误：localStorage 供事后排查。 */
function recordError(error, info) {
  const message = String(error?.message ?? error)
  pushRecord({
    at: new Date().toISOString(),
    kind: info?.kind ?? 'plugin',
    message: message.slice(0, 700),
    stack: String(error?.stack ?? info?.componentStack ?? '').slice(0, 900),
  })
  return message
}

/** 全局兜底：把窗口级错误与 console.error 落盘，避免入口被静默退役后无线索。 */
function installErrorTraps() {
  if (typeof window === 'undefined') return () => {}
  const onError = (event) => {
    pushRecord({
      at: new Date().toISOString(),
      kind: 'window.error',
      message: String(event?.message ?? event?.error?.message ?? '').slice(0, 700),
      stack: String(event?.error?.stack ?? '').slice(0, 900),
    })
  }
  const onRejection = (event) => {
    const reason = event?.reason
    pushRecord({
      at: new Date().toISOString(),
      kind: 'unhandledrejection',
      message: String(reason?.message ?? reason ?? '').slice(0, 700),
      stack: String(reason?.stack ?? '').slice(0, 900),
    })
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  if (window.__liangCalibratorConsoleTrapped !== true) {
    window.__liangCalibratorConsoleTrapped = true
    const original = console.error
    console.error = (...args) => {
      try {
        const text = args
          .map((value) => (value instanceof Error ? `${value.message}\n${value.stack}` : String(value)))
          .join(' ')
        pushRecord({ at: new Date().toISOString(), kind: 'console.error', message: text.slice(0, 1200), stack: '' })
      } catch {
        // ignore
      }
      original.apply(console, args)
    }
  }
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

/* --------------------------- 档位映射的本地设置 --------------------------- */

const emptyOverrides = () => ({
  stages: new Array(STAGES.length).fill(null),
  frames: new Array(SCORE_COUNT).fill(null),
})

function normalizeOverride(entry) {
  if (entry === null || typeof entry !== 'object') return null
  const provider = typeof entry.provider === 'string' ? entry.provider.trim() : ''
  const model = typeof entry.model === 'string' ? entry.model.trim() : ''
  const effort = typeof entry.effort === 'string' ? entry.effort.trim() : ''
  if (provider === '' && model === '' && effort === '') return null
  return effort === '' ? { provider, model } : { provider, model, effort }
}

/**
 * 读取档位映射设置。两层粒度：
 * - `stages`：六个状态各一条（整段生效）；
 * - `frames`：31 档逐档覆盖（优先于状态）。
 * 旧版本只存了六元素数组，这里兼容迁移。
 */
function readOverrides() {
  const empty = emptyOverrides()
  try {
    const raw = window.localStorage.getItem(OVERRIDE_KEY)
    if (raw === null) return empty
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return {
        stages: Array.from({ length: STAGES.length }, (_, index) => normalizeOverride(parsed[index])),
        frames: empty.frames,
      }
    }
    if (parsed !== null && typeof parsed === 'object') {
      return {
        stages: Array.from({ length: STAGES.length }, (_, index) => normalizeOverride(parsed.stages?.[index])),
        frames: Array.from({ length: SCORE_COUNT }, (_, index) => normalizeOverride(parsed.frames?.[index])),
      }
    }
    return empty
  } catch {
    return empty
  }
}

function writeOverrides(overrides) {
  try {
    window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(overrides))
  } catch {
    // 存不下只影响持久化。
  }
}

/* --------------------------- 档位名字与自定义背图 --------------------------- */

function readNames() {
  try {
    const raw = window.localStorage.getItem(NAMES_KEY)
    return normalizeNames(raw === null ? [] : JSON.parse(raw))
  } catch {
    return normalizeNames([])
  }
}

function writeNames(names) {
  try {
    window.localStorage.setItem(NAMES_KEY, JSON.stringify(normalizeNames(names)))
  } catch {
    // 存不下只影响持久化。
  }
}

function readImageMap() {
  try {
    const raw = window.localStorage.getItem(IMAGES_KEY)
    const parsed = raw === null ? [] : JSON.parse(raw)
    return Array.from({ length: SCORE_COUNT }, (_, index) => {
      const value = Array.isArray(parsed) ? parsed[index] : undefined
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
    })
  } catch {
    return new Array(SCORE_COUNT).fill(null)
  }
}

function writeImageMap(imageMap) {
  try {
    window.localStorage.setItem(IMAGES_KEY, JSON.stringify(imageMap))
  } catch {
    // 存不下只影响持久化。
  }
}

/** 建 object URL；环境不支持时返回空串（调用方回退内置图）。 */
function makeObjectUrl(blob) {
  try {
    if (typeof URL.createObjectURL !== 'function') return ''
    return URL.createObjectURL(blob)
  } catch {
    return ''
  }
}

function revokeObjectUrl(url) {
  try {
    if (url !== '' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
  } catch {
    // 撤销失败只影响内存。
  }
}

/** 一条设置是否真的指定了路由（provider + model 都填了才算）。 */
function overrideApplies(override) {
  return override !== null && override !== undefined
    && typeof override.provider === 'string' && override.provider.trim() !== ''
    && typeof override.model === 'string' && override.model.trim() !== ''
}

/* --------------------------- 背景图（全屏） --------------------------- */

function parseRgb(value) {
  const match = /^rgba?\(([^)]+)\)$/u.exec(value ?? '')
  if (match === null) return null
  const parts = match[1].split(/[\s,/]+/u).filter((part) => part !== '').map(Number)
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length >= 4 && Number.isFinite(parts[3]) ? parts[3] : 1 }
}

/**
 * 把控件到 body 之间的祖先面板**彻底**变透明，让底图真正透出来。
 * 可读性交给背景图层自带的压暗层（.ls-wallpaper-scrim）。
 */
function makeAncestorsTransparent(from) {
  const changed = []
  let node = from?.parentElement ?? null
  while (node !== null && node !== document.documentElement) {
    const computed = window.getComputedStyle(node)
    const rgb = parseRgb(computed.backgroundColor)
    const opaque = rgb !== null && rgb.a > 0.02
    const hasImage = typeof computed.backgroundImage === 'string'
      && computed.backgroundImage !== '' && computed.backgroundImage !== 'none'
    if (opaque || hasImage) {
      changed.push({ node, color: node.style.backgroundColor, image: node.style.backgroundImage })
      if (opaque) node.style.setProperty('background-color', 'transparent', 'important')
      if (hasImage) node.style.setProperty('background-image', 'none', 'important')
    }
    node = node.parentElement
  }
  return () => {
    for (const entry of changed) {
      if (entry.color === '') entry.node.style.removeProperty('background-color')
      else entry.node.style.setProperty('background-color', entry.color)
      if (entry.image === '') entry.node.style.removeProperty('background-image')
      else entry.node.style.setProperty('background-image', entry.image)
    }
  }
}

function ensureWallpaper(ref) {
  if (ref.current !== null) return ref.current
  const root = document.createElement('div')
  root.dataset.plugin = 'dsh-liang-calibrator-wallpaper'
  root.className = 'ls-wallpaper'
  const blur = document.createElement('img')
  blur.className = 'ls-wallpaper-blur'
  blur.alt = ''
  blur.draggable = false
  const sharp = document.createElement('img')
  sharp.className = 'ls-wallpaper-sharp'
  sharp.alt = ''
  sharp.draggable = false
  const scrim = document.createElement('div')
  scrim.className = 'ls-wallpaper-scrim'
  root.append(blur, sharp, scrim)
  document.body.insertBefore(root, document.body.firstChild)
  const layer = { root, blur, sharp, scrim }
  ref.current = layer
  return layer
}

/* ------------------------------ 组件部分 ------------------------------ */

/** 当前选择不属于梯子时的回退标签。 */
function currentSelectionLabel(current, state) {
  for (const group of state.groups ?? []) {
    if (group.id !== current.provider) continue
    const model = group.models.find((m) => m.id === current.model)
    if (model) return { provider: current.provider, name: model.name ?? model.id, effort: current.reasoningEffort }
  }
  return { provider: current.provider, name: current.model, effort: current.reasoningEffort }
}

/** 错误边界：内部异常就地显示，不再让插槽把入口退役。 */
function makeErrorBoundary() {
  const Component = React.Component
  if (typeof Component !== 'function') return null
  return class LiangErrorBoundary extends Component {
    constructor(props) {
      super(props)
      this.state = { message: null }
    }

    static getDerivedStateFromError(error) {
      return { message: recordError(error, { kind: 'render' }) }
    }

    componentDidCatch(error, info) {
      pushRecord({
        at: new Date().toISOString(),
        kind: 'render/componentStack',
        message: String(error?.message ?? error).slice(0, 700),
        stack: String(info?.componentStack ?? '').slice(0, 900),
      })
    }

    render() {
      if (this.state.message === null) return this.props.children
      return (
        <span className="ls-err" role="alert">
          校准器内部错误：{this.state.message}
        </span>
      )
    }
  }
}

/** 面向前端插槽的控件组件（导出以便本地 jsdom 测试）。 */
export function LiangCalibrator({ locked, available, directory, load, select }) {
  const state = useSyncExternalStore(
    (notify) => directory.subscribe(notify),
    () => directory.getSnapshot(),
  )
  const [score, setScore] = useState(0)
  const [pending, setPending] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [overrides, setOverrides] = useState(readOverrides)
  const [names, setNames] = useState(readNames)
  const [imageMap, setImageMap] = useState(readImageMap)
  // 图片缓存变动只用来触发重渲染（值本身不读）。
  const [, setImageCacheTick] = useState(0)
  const [imageError, setImageError] = useState(null)
  const [imageNotice, setImageNotice] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [view, setView] = useState('slider')
  const [settingsMode, setSettingsMode] = useState('stage')
  const [anchor, setAnchor] = useState(null)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)
  const wallpaperRef = useRef(null)
  const wallpaperTimerRef = useRef(null)
  const restoreRef = useRef(null)
  /** 图片 id → object URL 的缓存（页面会话内有效，卸载时统一撤销）。 */
  const imageCacheRef = useRef(null)
  if (imageCacheRef.current === null) imageCacheRef.current = new Map()
  /** 组件是否还在树上：异步的图片入库回来时用来决定「放入缓存」还是「直接撤销」。 */
  const aliveRef = useRef(true)
  const sliderId = useId()
  const listId = useId()

  const groups = state.groups ?? []

  // 自动梯子用的"模型分档"落点（MODEL_TIERS 顺序即强度顺序）。
  const tierEntries = useMemo(() => {
    const table = new Map()
    for (const modelId of MODEL_TIERS) {
      const group = groups.find((g) => g.models.some((m) => m.id === modelId))
      const model = group?.models.find((m) => m.id === modelId)
      table.set(modelId, { group, model })
    }
    return table
  }, [groups])

  const activeTiers = useMemo(
    () => MODEL_TIERS.filter((modelId) => tierEntries.get(modelId)?.group !== undefined),
    [tierEntries],
  )

  const effortsFor = (modelId) => {
    const entry = tierEntries.get(modelId)
    if (entry === undefined || entry.group === undefined) return undefined
    return entry.model?.reasoning?.efforts ?? []
  }

  /** 自动梯子：模型按状态带切分 + 段内等级均分。 */
  const autoLadder = useMemo(
    () => buildLadder(activeTiers, effortsFor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTiers, tierEntries],
  )

  /** 最终梯子：逐档设置优先于状态设置，都没有就用自动分档。 */
  const ladder = useMemo(() => {
    const anyStage = overrides.stages.some(overrideApplies)
    const anyFrame = overrides.frames.some(overrideApplies)
    if (!anyStage && !anyFrame) return autoLadder
    return autoLadder.map((combo, frame) => {
      const frameOverride = overrides.frames[frame]
      const stageOverride = overrides.stages[stageIndexFor(frame)]
      const override = overrideApplies(frameOverride) ? frameOverride : overrideApplies(stageOverride) ? stageOverride : null
      if (override === null) return combo
      const provider = override.provider.trim()
      const modelId = override.model.trim()
      const effort = typeof override.effort === 'string' ? override.effort.trim() : ''
      return effort === ''
        ? { provider, modelId, effort: undefined }
        : { provider, modelId, effort }
    })
  }, [autoLadder, overrides])

  /** 设置里可用的候选（datalist 自动补全，仍然允许手填任意值）。 */
  const suggestions = useMemo(() => ({
    providers: [...new Set(groups.map((group) => group.id))],
    models: [...new Set(groups.flatMap((group) => group.models.map((model) => model.id)))],
    efforts: [...new Set(groups.flatMap((group) => group.models.flatMap((model) => (
      (model.reasoning?.efforts ?? [])
        .map((effort) => (typeof effort === 'string' ? effort : effort?.id))
        .filter((id) => typeof id === 'string' && id !== '')
    ))))],
  }), [groups])

  /** 一档对应的 (分组, 模型)：显式指定优先，否则回落到自动分档。 */
  const entryFor = (combo) => {
    if (combo === undefined) return undefined
    if (combo.provider !== undefined) {
      const group = groups.find((g) => g.id === combo.provider)
      const model = group?.models.find((m) => m.id === combo.modelId)
      return { group, model }
    }
    return tierEntries.get(combo.modelId)
  }

  /** 该帧的档位是否就是当前真实选择。 */
  const matchesCurrent = (frame) => {
    const combo = ladder[frame]
    const current = state.current
    if (combo === undefined || current === null || current === undefined) return false
    if (combo.provider !== undefined) {
      // 手填的路由目录里未必有，按字面比较；没填等级时只要 provider+模型对得上就算命中。
      if (current.provider !== combo.provider || current.model !== combo.modelId) return false
      if (combo.effort === undefined) return true
      return (current.reasoningEffort ?? undefined) === combo.effort
    }
    const entry = entryFor(combo)
    if (entry === undefined || entry.group === undefined || entry.model === undefined) return false
    const effort = current.reasoningEffort ?? entry.model.reasoning?.defaultEffort
    return (
      entry.group.id === current.provider &&
      entry.model.id === current.model &&
      (effort ?? undefined) === (combo.effort ?? undefined)
    )
  }

  /** 当前真实选择覆盖的帧区间（可能为空：选择不在梯子上）。 */
  const currentFrames = useMemo(() => {
    const frames = []
    for (let frame = 0; frame < SCORE_COUNT; frame += 1) if (matchesCurrent(frame)) frames.push(frame)
    return frames
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ladder, tierEntries, groups, state.current])

  /** 至少有一档能提交，滑杆才可用（手填路由交给平台裁决，算可用）。 */
  const usableFrames = useMemo(() => {
    let usable = 0
    for (let frame = 0; frame < SCORE_COUNT; frame += 1) {
      const combo = ladder[frame]
      if (combo === undefined) continue
      if (combo.provider !== undefined) {
        usable += 1
        continue
      }
      const entry = entryFor(combo)
      if (entry?.group !== undefined && entry.model !== undefined) usable += 1
    }
    return usable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ladder, tierEntries, groups])

  // 目录加载：按退避重试到目录到手为止，并允许手动重试。
  const loadRef = useRef(load)
  loadRef.current = load
  const [loadAttempts, setLoadAttempts] = useState(0)
  const [retryToken, setRetryToken] = useState(0)
  const groupsReady = groups.length > 0

  useEffect(() => {
    if (!available || groupsReady) return undefined
    const manual = retryToken > 0
    if (!manual && (state.status === 'loading' || state.status === 'selecting')) return undefined
    if (loadAttempts >= 8) return undefined
    const timer = window.setTimeout(() => {
      try {
        loadRef.current()
      } catch (error) {
        recordError(error, { kind: 'load' })
      }
      setLoadAttempts((count) => count + 1)
    }, loadAttempts === 0 || manual ? 0 : 2000)
    return () => window.clearTimeout(timer)
  }, [available, groupsReady, state.status, loadAttempts, retryToken])

  const retryLoad = () => {
    setLoadAttempts(0)
    setRetryToken((token) => token + 1)
  }

  useEffect(() => {
    writeOverrides(overrides)
  }, [overrides])

  useEffect(() => {
    writeNames(names)
  }, [names])

  useEffect(() => {
    writeImageMap(imageMap)
  }, [imageMap])

  // 自定义背图：加载已用到的图片、撤掉不再引用的 object URL、回收孤儿条目。
  useEffect(() => {
    let alive = true
    const sync = async () => {
      const wanted = new Set(imageMap.filter((id) => typeof id === 'string' && id !== ''))
      let changed = false
      for (const id of wanted) {
        if (imageCacheRef.current.has(id)) continue
        const blob = await galleryGet(id)
        if (!alive) return
        if (blob !== null && blob !== undefined) {
          const url = makeObjectUrl(blob)
          if (url !== '') {
            imageCacheRef.current.set(id, url)
            changed = true
          }
        }
      }
      if (!alive) return
      for (const [id, url] of [...imageCacheRef.current]) {
        if (wanted.has(id)) continue
        revokeObjectUrl(url)
        imageCacheRef.current.delete(id)
        changed = true
      }
      if (!alive) return
      if (changed) setImageCacheTick((tick) => tick + 1)
      await galleryGC([...wanted])
    }
    sync().catch((error) => {
      recordError(error, { kind: 'gallery/sync' })
    })
    return () => {
      alive = false
    }
  }, [imageMap])

  // 外部改变模型时把滑杆移到对应区间。
  useEffect(() => {
    const current = state.current
    if (current === null || current === undefined) return
    if (matchesCurrent(frameIndexFor(score))) return
    if (currentFrames.length === 0) return
    const target = scoreOfFrame(currentFrames[Math.floor(currentFrames.length / 2)])
    if (target !== score) setScore(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFrames])

  useEffect(() => {
    if (pending === null) return
    if (state.status === 'error' || matchesCurrent(frameIndexFor(pending))) setPending(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, currentFrames, state.status])

  // 悬浮面板位置：贴着三角按钮上沿，并夹在视口内。
  useEffect(() => {
    if (!expanded) {
      setAnchor(null)
      return undefined
    }
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - 24)
      const right = Math.max(12, Math.min(window.innerWidth - width - 12, window.innerWidth - rect.right))
      const bottom = Math.max(12, window.innerHeight - rect.top + 8)
      setAnchor({ right, bottom, width })
    }
    update()
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
    }
  }, [expanded])

  // 点面板外或按 Esc 收起。
  useEffect(() => {
    if (!expanded) return undefined
    const onDown = (event) => {
      if (popoverRef.current?.contains(event.target) === true) return
      if (triggerRef.current?.contains(event.target) === true) return
      setExpanded(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [expanded])

  // 卸载时清掉背景图与定时器，并撤销自定义背图的 object URL。
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      if (wallpaperTimerRef.current !== null) window.clearTimeout(wallpaperTimerRef.current)
      const restore = restoreRef.current
      if (restore !== null) restore()
      const layer = wallpaperRef.current
      if (layer !== null && layer.root.parentNode !== null) layer.root.parentNode.removeChild(layer.root)
      for (const url of imageCacheRef.current.values()) revokeObjectUrl(url)
      imageCacheRef.current.clear()
    }
  }, [])

  if (!available) return null

  const localFrame = frameIndexFor(score)
  /** 当前档的显示名：自定义优先，否则回落默认梁名。 */
  const stageName = displayNameAt(names, localFrame)
  /** 该档要铺的背景图：自定义优先；图还没加载好时先用内置档位图兜底。 */
  const urlForFrame = (frame) => {
    const id = imageMap[frame]
    const custom = id === null || id === undefined ? '' : imageCacheRef.current.get(id) ?? ''
    return custom !== '' ? custom : FRAMES[frame]
  }

  const setNameAt = (frame, value) => {
    setNames((current) => {
      const next = [...current]
      next[frame] = String(value).slice(0, NAME_MAX_LENGTH)
      return next
    })
  }

  /** 用户挑好图片：压缩 → 按内容哈希入库 → 记到该档。 */
  const assignImage = async (frame, file) => {
    setImageError(null)
    setImageNotice(null)
    try {
      const prepared = await compressImageFile(file)
      const id = await imageFileId(prepared.blob)
      const stored = await galleryPut(id, prepared.blob)
      if (!stored.ok) throw new Error('图片没有存上')
      const url = makeObjectUrl(prepared.blob)
      if (url !== '' && aliveRef.current) {
        imageCacheRef.current.set(id, url)
        setImageCacheTick((tick) => tick + 1)
      } else if (url !== '') {
        revokeObjectUrl(url)
      }
      if (!aliveRef.current) return
      if (!stored.persisted) {
        setImageNotice('本机存储不可用：这张图只在本次会话有效，刷新后会回到内置图。')
      }
      setImageMap((current) => {
        const next = [...current]
        next[frame] = id
        return next
      })
    } catch (error) {
      const message = recordError(error, { kind: 'gallery/assign' })
      setImageError(`第 ${formatSignedScore(scoreOfFrame(frame))} 档的背图没有保存：${message}`)
    }
  }

  const clearImageAt = (frame) => {
    setImageError(null)
    setImageNotice(null)
    setImageMap((current) => {
      const next = [...current]
      next[frame] = null
      return next
    })
  }

  /** 设置面板右上角的清空按钮：按当前粒度清路由 / 名字 / 背图。 */
  const clearActiveSettings = () => {
    if (settingsMode === 'name') setNames(normalizeNames([]))
    else if (settingsMode === 'image') {
      setImageMap(new Array(SCORE_COUNT).fill(null))
      setImageError(null)
      setImageNotice(null)
    } else clearOverrides()
  }

  /* ---- 滑动时把档位图铺成 DSH 背景，停手 5 秒后淡出 ---- */
  const hideWallpaper = () => {
    if (wallpaperTimerRef.current !== null) {
      window.clearTimeout(wallpaperTimerRef.current)
      wallpaperTimerRef.current = null
    }
    const layer = wallpaperRef.current
    if (layer !== null) layer.root.classList.remove('ls-wallpaper-on')
    const restore = restoreRef.current
    restoreRef.current = null
    if (restore !== null) window.setTimeout(restore, WALLPAPER_FADE_MS)
  }

  const showWallpaper = (frame) => {
    const layer = ensureWallpaper(wallpaperRef)
    const url = urlForFrame(frame)
    if (layer.sharp.getAttribute('src') !== url) {
      layer.sharp.setAttribute('src', url)
      layer.blur.setAttribute('src', url)
    }
    layer.root.classList.add('ls-wallpaper-on')
    if (restoreRef.current === null) restoreRef.current = makeAncestorsTransparent(rootRef.current)
    if (wallpaperTimerRef.current !== null) window.clearTimeout(wallpaperTimerRef.current)
    wallpaperTimerRef.current = window.setTimeout(hideWallpaper, WALLPAPER_HIDE_MS)
  }

  const updateOverride = (mode, index, patch) => {
    setOverrides((current) => {
      const list = mode === 'frame' ? current.frames : current.stages
      const existing = list[index] ?? { provider: '', model: '' }
      const merged = { ...existing, ...patch }
      const provider = typeof merged.provider === 'string' ? merged.provider.trim() : ''
      const model = typeof merged.model === 'string' ? merged.model.trim() : ''
      const effort = typeof merged.effort === 'string' ? merged.effort.trim() : ''
      const entry = provider === '' && model === '' && effort === ''
        ? null
        : effort === '' ? { provider, model } : { provider, model, effort }
      const nextList = [...list]
      nextList[index] = entry
      return mode === 'frame' ? { ...current, frames: nextList } : { ...current, stages: nextList }
    })
  }

  const clearOverrides = () => setOverrides(emptyOverrides())

  /** 自动分档下这一档会用哪条路由（作为输入框的占位提示）。 */
  const autoRoute = (frame) => {
    const combo = autoLadder[frame]
    if (combo === undefined) return null
    const entry = tierEntries.get(combo.modelId)
    return { provider: entry?.group?.id ?? '', model: combo.modelId, effort: combo.effort }
  }

  const chipFrame =
    pending !== null
      ? frameIndexFor(pending)
      : currentFrames.length > 0 && matchesCurrent(localFrame)
        ? localFrame
        : currentFrames.length > 0
          ? currentFrames[Math.floor(currentFrames.length / 2)]
          : -1
  const chipStage = chipFrame >= 0 ? displayNameAt(names, chipFrame) : null
  const chipCombo = chipFrame >= 0 ? ladder[chipFrame] : undefined
  const chipEntry = chipCombo === undefined ? undefined : entryFor(chipCombo)
  const fallback = state.current == null ? null : currentSelectionLabel(state.current, state)

  // 当前这条路由：provider / 模型名 / 思考强度。折叠态与展开态都用它做文案。
  const route = chipCombo === undefined
    ? fallback === null
      ? null
      : { provider: fallback.provider, model: fallback.name, effort: fallback.effort }
    : {
        provider: chipCombo.provider ?? chipEntry?.group?.id,
        model: chipEntry?.model?.name ?? chipCombo.modelId,
        effort: chipCombo.effort,
      }
  const modelLabel = route?.model ?? '选择模型'
  const effortLabel = route === null ? undefined : route.effort ?? '默认'
  /** 折叠态：提供商 · 模型 · 思考强度。 */
  const routeLabel = route === null
    ? modelLabel
    : [route.provider, route.model, effortLabel].filter((part) => part !== undefined && part !== null && part !== '').join(' · ')
  /** 展开态次行：提供商 · 思考强度（模型名单独放大显示）。 */
  const routeSub = route === null
    ? ''
    : [route.provider, effortLabel].filter((part) => part !== undefined && part !== null && part !== '').join(' · ')

  const busy = state.status === 'selecting'
  const scoreLabel = formatSignedScore(scoreOfFrame(chipFrame >= 0 ? chipFrame : localFrame))
  const wiperPercent = ((score - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * 100
  const blockedReason = locked
    ? '本会话已锁定'
    : usableFrames === 0
      ? groupsReady ? '档位模型不可用' : '模型目录未就绪'
      : null
  const disabled = blockedReason !== null

  const commit = async (frame) => {
    const combo = ladder[frame]
    if (combo === undefined) return
    const entry = entryFor(combo)
    const provider = combo.provider ?? entry?.group?.id
    const model = combo.modelId ?? entry?.model?.id
    if (provider === undefined || model === undefined || provider === '' || model === '') return
    if (matchesCurrent(frame)) return
    setActionError(null)
    setPending(scoreOfFrame(frame))
    let accepted = false
    try {
      accepted = await select({
        provider,
        model,
        ...combo.effort === undefined ? {} : { reasoningEffort: combo.effort },
      })
    } catch (error) {
      recordError(error, { kind: 'select' })
    }
    if (!accepted) {
      setPending(null)
      setActionError(directory.getSnapshot().error ?? '档位切换失败')
    }
  }

  const onInput = (event) => {
    const next = Number(event.target.value)
    const frame = frameIndexFor(next)
    setScore(next)
    try {
      showWallpaper(frame)
    } catch (error) {
      recordError(error, { kind: 'wallpaper' })
    }
    void commit(frame)
  }

  return (
    <div className="ls-root" ref={rootRef}>
      <datalist id={`${listId}-providers`}>
        {suggestions.providers.map((provider) => <option key={provider} value={provider} />)}
      </datalist>
      <datalist id={`${listId}-models`}>
        {suggestions.models.map((model) => <option key={model} value={model} />)}
      </datalist>
      <datalist id={`${listId}-efforts`}>
        {suggestions.efforts.map((effort) => <option key={effort} value={effort} />)}
      </datalist>

      <button
        type="button"
        ref={triggerRef}
        className={`ls-trigger${expanded ? ' ls-trigger-on' : ''}`}
        aria-expanded={expanded}
        aria-haspopup="dialog"
        title={routeLabel}
        onClick={() => setExpanded((open) => {
          if (!open) setView('slider')
          return !open
        })}
      >
        <span className="ls-tri" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span className="ls-trigger-text">{routeLabel}</span>
      </button>

      {blockedReason !== null && (
        <span className="ls-blocked" role="status">
          {blockedReason}
          {locked ? '' : (
            <button type="button" className="ls-retry" onClick={retryLoad}>重试</button>
          )}
        </span>
      )}
      {(actionError ?? state.error) != null && (
        <span className="ls-err" role="alert">{actionError ?? state.error}</span>
      )}

      {expanded && (
        <div
          className="ls-popover"
          ref={popoverRef}
          role="dialog"
          aria-label="滑动变祖器"
          style={anchor === null
            ? { visibility: 'hidden' }
            : { right: `${anchor.right}px`, bottom: `${anchor.bottom}px`, width: `${anchor.width}px` }}
        >
          <div className="ls-popover-head">
            {view === 'settings' ? (
              <span className="ls-mode" role="group" aria-label="设置粒度">
                <button
                  type="button"
                  className={`ls-mode-btn${settingsMode === 'stage' ? ' ls-mode-on' : ''}`}
                  onClick={() => setSettingsMode('stage')}
                >
                  按状态 6
                </button>
                <button
                  type="button"
                  className={`ls-mode-btn${settingsMode === 'frame' ? ' ls-mode-on' : ''}`}
                  onClick={() => setSettingsMode('frame')}
                >
                  按档位 31
                </button>
                <button
                  type="button"
                  className={`ls-mode-btn${settingsMode === 'name' ? ' ls-mode-on' : ''}`}
                  onClick={() => setSettingsMode('name')}
                >
                  名字 31
                </button>
                <button
                  type="button"
                  className={`ls-mode-btn${settingsMode === 'image' ? ' ls-mode-on' : ''}`}
                  onClick={() => setSettingsMode('image')}
                >
                  背图 31
                </button>
              </span>
            ) : (
              <span className="ls-popover-title">滑动变祖器</span>
            )}
            {view === 'settings' && (
              <button type="button" className="ls-settings-clear" onClick={clearActiveSettings}>
                {settingsMode === 'name' ? '全部默认' : settingsMode === 'image' ? '全部内置' : '全部自动'}
              </button>
            )}
            <button
              type="button"
              className={`ls-gear${view === 'settings' ? ' ls-gear-on' : ''}`}
              aria-label="档位设置"
              title="档位设置：按状态 / 按档位指定路由，逐档改名与挑背图"
              onClick={() => setView((current) => current === 'settings' ? 'slider' : 'settings')}
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <circle cx="8" cy="8" r="5.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeDasharray="2.5 1.7" />
                <circle cx="8" cy="8" r="1.8" fill="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              className="ls-close"
              aria-label="关闭"
              title="关闭"
              onClick={() => setExpanded(false)}
            >
              ✕
            </button>
          </div>

          {view === 'settings' ? (
            <div className="ls-settings">
              {settingsMode === 'stage' && STAGES.map((stageLabel, index) => {
                const override = overrides.stages[index]
                const hint = autoRoute(firstFrameOfStage(index))
                return (
                  <SettingRow
                    key={stageLabel}
                    label={stageLabel}
                    title={stageLabel}
                    listId={listId}
                    override={override}
                    hint={hint}
                    known={override?.provider === undefined || override.provider === '' || groups.some((group) => group.id === override.provider)}
                    onChange={(patch) => updateOverride('stage', index, patch)}
                  />
                )
              })}
              {settingsMode === 'frame' && Array.from({ length: SCORE_COUNT }, (_, frame) => {
                const override = overrides.frames[frame]
                const hint = autoRoute(frame)
                const frameScore = formatSignedScore(scoreOfFrame(frame))
                return (
                  <SettingRow
                    key={frame}
                    label={frameScore}
                    title={`${frameScore} · ${displayNameAt(names, frame)}`}
                    listId={listId}
                    override={override}
                    hint={hint}
                    known={override?.provider === undefined || override.provider === '' || groups.some((group) => group.id === override.provider)}
                    onChange={(patch) => updateOverride('frame', frame, patch)}
                  />
                )
              })}
              {settingsMode === 'name' && Array.from({ length: SCORE_COUNT }, (_, frame) => {
                const frameScore = formatSignedScore(scoreOfFrame(frame))
                return (
                  <NameRow
                    key={frame}
                    label={frameScore}
                    title={`${frameScore} · ${STAGES[stageIndexFor(frame)]}`}
                    placeholder={STAGES[stageIndexFor(frame)]}
                    value={names[frame] ?? ''}
                    onChange={(value) => setNameAt(frame, value)}
                  />
                )
              })}
              {settingsMode === 'image' && Array.from({ length: SCORE_COUNT }, (_, frame) => {
                const frameScore = formatSignedScore(scoreOfFrame(frame))
                const id = imageMap[frame]
                const thumb = id === null || id === undefined ? '' : imageCacheRef.current.get(id) ?? ''
                return (
                  <ImageRow
                    key={frame}
                    label={frameScore}
                    title={`${frameScore} · ${displayNameAt(names, frame)}`}
                    thumbUrl={thumb}
                    onPick={(file) => assignImage(frame, file)}
                    onClear={() => clearImageAt(frame)}
                  />
                )
              })}
              {settingsMode === 'image' && imageError !== null && (
                <p className="ls-settings-error" role="alert">{imageError}</p>
              )}
              {settingsMode === 'image' && imageNotice !== null && (
                <p className="ls-settings-note">{imageNotice}</p>
              )}
              <p className="ls-settings-hint">
                {settingsMode === 'stage' && '六个状态各一条：填了 provider 与模型后，该状态内的每一档都用这条路由。'}
                {settingsMode === 'frame' && '31 档逐档设置，优先于「按状态」的设置；灰色占位符是自动分档会选的模型。'}
                {settingsMode === 'name' && '给 31 档各起一个名字：留空用默认梁名；相邻档位写成同一个名字就合并成一段，滑杆下方的站名行会跟着变。'}
                {settingsMode === 'image' && '给 31 档各挑一张自定义背图：滑动到该档时铺在窗口上，留空用内置档位图；图片只存本机（IndexedDB），同一张图给多个档位只存一份。'}
                {settingsMode === 'stage' || settingsMode === 'frame' ? (
                  <> {' '}三项都能直接填（provider / 模型 id / 思考强度 <code>off</code>、<code>high</code>、<code>max</code>…），留空即沿用上一层。</>
                ) : null}
              </p>
            </div>
          ) : (
            <div className="ls-body">
              <span className={`ls-chip${busy ? ' ls-busy' : ''}`} title={routeLabel}>
                <span className="ls-chip-main">
                  <span className="ls-model">{modelLabel}</span>
                  <span className="ls-chip-tags">
                    {chipStage !== null && <span className="ls-stage">{chipStage}</span>}
                    <span className="ls-score">{scoreLabel}</span>
                  </span>
                </span>
                {routeSub !== '' && <span className="ls-sub">{routeSub}</span>}
              </span>

              <div className="ls-rheostat" data-blocked={disabled ? 'true' : 'false'}>
                <span className="ls-plate ls-plate-left" aria-hidden="true"><span className="ls-plate-post" /></span>
                <span className="ls-plate ls-plate-right" aria-hidden="true"><span className="ls-plate-post" /></span>
                <span className="ls-base" aria-hidden="true" />
                <span className="ls-rod" aria-hidden="true" />
                <span className="ls-tube" aria-hidden="true">
                  <span className="ls-windings" />
                  <span className="ls-coil-live" style={{ width: `${wiperPercent}%` }} />
                </span>
                <span className="ls-post ls-post-left" aria-hidden="true" />
                <span className="ls-post ls-post-right" aria-hidden="true" />
                <span className="ls-wiper-track" aria-hidden="true">
                  <span className="ls-wiper" style={{ left: `${wiperPercent}%` }}>
                    <span className="ls-wiper-plate" />
                    <span className="ls-wiper-wedge" />
                    <span className="ls-wiper-tip" />
                  </span>
                </span>
                <input
                  id={sliderId}
                  className="ls-range"
                  type="range"
                  min={String(MIN_SCORE)}
                  max={String(MAX_SCORE)}
                  step="1"
                  value={String(score)}
                  disabled={disabled}
                  aria-label="梁系强度（模型与推理等级）"
                  aria-valuetext={`${stageName} ${formatSignedScore(scoreOfFrame(localFrame))} ${routeLabel}`}
                  onChange={onInput}
                />
              </div>

              <div className="ls-stations" aria-hidden="true">
                {visibleRuns(nameRuns(names), localFrame).map((run) => {
                  let available1 = false
                  for (let frame = run.start; frame <= run.end; frame += 1) {
                    const combo = ladder[frame]
                    const entry = entryFor(combo)
                    if (combo?.provider !== undefined || (entry?.group !== undefined && entry.model !== undefined)) {
                      available1 = true
                      break
                    }
                  }
                  return (
                    <span
                      key={`${run.start}-${run.end}`}
                      className={`ls-station${run.active ? ' ls-station-active' : ''}`}
                      data-available={available1 ? 'true' : 'false'}
                      style={{ left: `calc(30px + (100% - 60px) * ${run.center.toFixed(4)})` }}
                    >
                      {run.name}
                    </span>
                  )
                })}
              </div>
              <div className="ls-ticks" aria-hidden="true">
                <span>{MIN_SCORE}</span>
                <span>0</span>
                <span>+{MAX_SCORE}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const boundaryRef = { current: undefined }

/** 设置里的一行：标签 + provider / 模型 / 思考强度三个可输入框（占位符提示自动值）。 */
function SettingRow({ label, title, listId, override, hint, known, onChange }) {
  return (
    <div className="ls-settings-row" data-unknown={known ? 'false' : 'true'} title={title}>
      <span className="ls-settings-stage">{label}</span>
      <input
        className="ls-settings-input"
        list={`${listId}-providers`}
        placeholder={hint?.provider === undefined || hint.provider === '' ? 'provider' : hint.provider}
        aria-label={`${title} 的 provider`}
        value={override?.provider ?? ''}
        onChange={(event) => onChange({ provider: event.target.value })}
      />
      <input
        className="ls-settings-input"
        list={`${listId}-models`}
        placeholder={hint?.model ?? '模型 id'}
        aria-label={`${title} 的模型`}
        value={override?.model ?? ''}
        onChange={(event) => onChange({ model: event.target.value })}
      />
      <input
        className="ls-settings-input"
        list={`${listId}-efforts`}
        placeholder={hint?.effort ?? '默认'}
        aria-label={`${title} 的思考强度`}
        value={override?.effort ?? ''}
        onChange={(event) => onChange({ effort: event.target.value })}
      />
    </div>
  )
}

/** 设置里的一行：「名字 31」——单输入框，占位符是默认梁名。 */
function NameRow({ label, title, placeholder, value, onChange }) {
  return (
    <div className="ls-settings-row ls-settings-row-name" title={title}>
      <span className="ls-settings-stage">{label}</span>
      <input
        className="ls-settings-input"
        aria-label={`${title} 的名字`}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

/** 设置里的一行：「背图 31」——缩略图 + 选图 + 清除。 */
function ImageRow({ label, title, thumbUrl, onPick, onClear }) {
  const filled = typeof thumbUrl === 'string' && thumbUrl !== ''
  return (
    <div className="ls-settings-row ls-settings-row-image" title={title} data-filled={filled ? 'true' : 'false'}>
      <span className="ls-settings-stage">{label}</span>
      {filled
        ? <img className="ls-settings-thumb" src={thumbUrl} alt="" draggable={false} />
        : <span className="ls-settings-empty">内置</span>}
      <label className="ls-settings-btn">
        选择图片
        <input
          type="file"
          accept="image/*"
          className="ls-settings-file"
          aria-label={`${title} 的背图`}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file !== undefined && file !== null) onPick(file)
          }}
        />
      </label>
      <button type="button" className="ls-settings-btn ls-settings-btn-clear" onClick={onClear} disabled={!filled}>
        清除
      </button>
    </div>
  )
}

/** 注册进插槽的入口：外面套一层错误边界，避免内部异常让插槽把入口旁路掉。 */
export function LiangSeat(props) {
  const Boundary = boundaryRef.current ?? (boundaryRef.current = makeErrorBoundary())
  const seat = <LiangCalibrator {...props} />
  return Boundary === null ? seat : <Boundary>{seat}</Boundary>
}

/**
 * 构造插槽注入面。
 *
 * **这里绝不能抛异常**：插槽渲染器在计算注入面时抛错，会把整个入口退役并静默退回
 * 官方控件（用户看到的就是"插件不起效"），而这类错误发生在插件自己的错误边界之外。
 *
 * @param ctx - 客户端插件上下文。
 * @returns 插槽的 inject 回调。
 */
export function createSeatInject(ctx) {
  return (sessionId) => {
    let available = true
    try {
      available = ctx.sessions.subagentAddress(sessionId) === undefined
    } catch (error) {
      recordError(error, { kind: 'inject/available' })
    }

    let resolved = null
    const resolve = () => {
      if (resolved === null) resolved = ctx.modelDirectories.directoryFor(sessionId)
      return resolved
    }
    const safe = (operation, fallback) => {
      try {
        return operation(resolve())
      } catch (error) {
        recordError(error, { kind: 'inject/directory' })
        return fallback
      }
    }

    return {
      available,
      get directory() {
        return safe((directory) => directory.store, EMPTY_STORE)
      },
      load: () => {
        if (!available) return
        safe((directory) => {
          void directory.load().catch(() => {})
        }, undefined)
      },
      select: (selection) => {
        if (!available) return Promise.resolve(false)
        return safe(
          (directory) => directory.select(selection).then(
            (result) => result === undefined || result.ok !== false,
            (error) => {
              recordError(error, { kind: 'select' })
              return false
            },
          ),
          Promise.resolve(false),
        )
      },
    }
  }
}

export function apply(ctx) {
  ctx.effect(() => installErrorTraps())

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-liang-calibrator'
    tag.textContent = styles
    document.head.appendChild(tag)
    return () => tag.remove()
  })

  ctx.slots.inject('conversation.input.model', () => ctx.slots.register({
    name: 'conversation.input.model',
    priority: -10,
    inject: createSeatInject(ctx),
  }, LiangSeat))
}
