// 用 jsdom + React 真渲染插件组件：既是回归测试，也是线上问题的复现台。
// 用法：node render-test.mjs
import { build } from 'esbuild'
import { readFile, rm } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

const FRAMES = 31
const frames = await Promise.all(
  Array.from({ length: FRAMES }, (_, i) => readFile(`./assets/frame-${String(i).padStart(2, '0')}.webp`)),
)
const defines = Object.fromEntries(
  frames.map((bytes, i) => [`__LIANG_IMG_${i}__`, JSON.stringify(`data:image/webp;base64,${bytes.toString('base64')}`)]),
)

await build({
  entryPoints: ['./src/client.jsx'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: './.client.test.cjs',
  external: ['react', 'react-dom', 'react-dom/client'],
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  define: defines,
  logLevel: 'warning',
})

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'http://127.0.0.1:5173/',
})
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { LiangCalibrator, LiangSeat, createSeatInject } = await import('./.client.test.cjs')

const EFFORTS = [
  { id: 'off', name: 'Off' },
  { id: 'low', name: 'Low' },
  { id: 'high', name: 'High' },
  { id: 'max', name: 'Max' },
]
const model = (id, name) => ({ id, name, reasoning: { efforts: EFFORTS, defaultEffort: 'high' } })

const CATALOG = {
  current: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'low' },
  routable: true,
  groups: [
    {
      id: 'deepseek-account',
      models: [model('deepseek-flash', 'DeepSeek-V41-Flash'), model('deepseek-v4-pro', 'DeepSeek-V4-Pro')],
    },
    {
      id: 'cmd',
      models: [{ id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }],
    },
  ],
  failures: [],
  status: 'ready',
  pending: null,
  error: null,
}

function createDirectory(snapshot) {
  let state = snapshot
  const listeners = new Set()
  const selections = []
  let loads = 0
  const notify = () => {
    for (const fn of [...listeners]) fn()
  }
  return {
    store: {
      getSnapshot: () => state,
      subscribe: (fn) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    },
    // 模拟真实 ModelDirectory.load()：每次都会 syncInputs() → store.set() → 通知订阅者。
    load: async () => {
      loads += 1
      state = { ...state, status: 'ready' }
      notify()
      return state
    },
    select: async (selection) => {
      selections.push(selection)
      return { ok: true, value: undefined }
    },
    set(next) {
      state = next
      notify()
    },
    get loads() {
      return loads
    },
    selections,
  }
}

const failures = []
const check = (condition, what) => {
  if (!condition) failures.push(what)
}
const NativeInput = dom.window.HTMLInputElement.prototype
const valueSetter = Object.getOwnPropertyDescriptor(NativeInput, 'value').set
const typeInto = async (element, value) => {
  await act(async () => {
    valueSetter.call(element, value)
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
const click = async (element) => {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
}

async function mount(snapshot, props = {}, { expand = true } = {}) {
  const dir = createDirectory(snapshot)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      React.createElement(LiangCalibrator, {
        locked: false,
        available: true,
        directory: dir.store,
        load: () => {},
        select: (selection) => dir.select(selection).then((r) => r.ok !== false),
        ...props,
      }),
    )
  })
  if (expand) {
    const trigger = container.querySelector('.ls-trigger')
    if (trigger !== null) await click(trigger)
  }
  return { dir, container, root }
}

// 1) 目录就绪：展开后是变阻器，芯片显示 provider · 模型 · 等级。
{
  const { container } = await mount(CATALOG)
  const text = container.textContent ?? ''
  check(container.querySelector('input.ls-range') !== null, '展开后应渲染滑杆')
  check(container.querySelectorAll('.ls-station').length === 6, '应渲染 6 个状态标签')
  check(text.includes('deepseek-account'), `芯片应显示提供商，实际：${text}`)
  check(text.includes('DeepSeek-V41-Flash'), `芯片应显示模型名，实际：${text}`)
  check(text.includes('low'), `芯片应显示推理等级，实际：${text}`)
  console.log('scenario 1 (catalog ready): ok')
}

// 2) 目录为空：滑杆禁用并给出原因与重试。
{
  const { container } = await mount({ current: null, routable: null, groups: [], failures: [], status: 'idle', pending: null, error: null })
  const input = container.querySelector('input.ls-range')
  check(input?.disabled === true, '空目录时滑杆应禁用')
  check((container.textContent ?? '').includes('模型目录未就绪'), '应说明原因')
  check(container.querySelector('.ls-retry') !== null, '应提供重试入口')
  console.log('scenario 2 (empty catalog): ok')
}

// 3) 当前选择不在梯子上：回退显示真实模型名。
{
  const { container } = await mount({
    ...CATALOG,
    current: { provider: 'other', model: 'some-other-model', reasoningEffort: 'max' },
  })
  const text = container.textContent ?? ''
  check(container.querySelector('input.ls-range').disabled === false, '外来选择不应禁用滑杆')
  check(text.includes('some-other-model'), `应回退显示真实模型名，实际：${text}`)
  console.log('scenario 3 (foreign provider): ok')
}

// 4) 子代理会话不渲染。
{
  const { container } = await mount(CATALOG, { available: false }, { expand: false })
  check(container.innerHTML === '', '不可用时不应渲染任何内容')
  console.log('scenario 4 (subagent session): ok')
}

// 5) cmd（不公布推理等级）：段内拖动不重复提交，拖到 pro 段才换。
{
  const { container, dir } = await mount({
    ...CATALOG,
    current: { provider: 'cmd', model: 'deepseek/deepseek-v4.1-flash' },
  })
  const text = container.textContent ?? ''
  check(text.includes('DeepSeek V4.1 Flash'), `芯片应显示 cmd 模型，实际：${text}`)
  check(text.includes('默认'), `无等级模型应显示「默认」，实际：${text}`)

  const input = container.querySelector('input.ls-range')
  await typeInto(input, '-2')
  check(dir.selections.length === 0, `段内拖动不应重复提交，实际 ${JSON.stringify(dir.selections)}`)
  await typeInto(input, '15')
  const submitted = dir.selections[0]
  check(submitted?.model === 'deepseek-v4-pro', `+15 应选 pro，实际 ${submitted?.model}`)
  check(['off', 'low', 'high', 'max'].includes(submitted?.reasoningEffort), `pro 段应带等级，实际 ${submitted?.reasoningEffort}`)
  console.log('scenario 5 (cmd without reasoning): ok')
}

// 6) cmd 缺席：梯子自动退回两段。
{
  const withoutCmd = { ...CATALOG, groups: CATALOG.groups.filter((g) => g.id !== 'cmd') }
  const { container } = await mount(withoutCmd)
  check(container.querySelector('input.ls-range').disabled === false, 'cmd 缺席时滑杆仍应可用')
  check([...container.querySelectorAll('.ls-station')].every((s) => s.dataset.available === 'true'), '状态标签仍应全部可用')
  console.log('scenario 6 (cmd absent): ok')
}

// 7) 回归：插槽每次重渲染换掉注入的 load 引用也不能循环。
{
  let renders = 0
  function Host({ dir }) {
    const [, force] = React.useState(0)
    React.useEffect(() => dir.store.subscribe(() => force((n) => n + 1)), [dir])
    renders += 1
    return React.createElement(LiangCalibrator, {
      locked: false,
      available: true,
      directory: dir.store,
      load: () => {
        void dir.load()
      },
      select: (selection) => dir.select(selection).then((r) => r.ok !== false),
    })
  }

  const dir = createDirectory(CATALOG)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let thrown = null
  try {
    await act(async () => {
      root.render(React.createElement(Host, { dir }))
    })
    for (let round = 0; round < 2; round += 1) {
      await act(async () => {
        dir.set({ ...dir.store.getSnapshot() })
      })
    }
  } catch (error) {
    thrown = error
  }
  check(thrown === null, `不稳定 load 引用不应导致抛错：${thrown?.message}`)
  check(dir.loads === 0, `目录已在 store 里时不应调用 load，实际 ${dir.loads} 次（渲染 ${renders} 次）`)
  console.log(`scenario 7 (unstable load identity): loads=${dir.loads}, renders=${renders}`)
}

// 8) 错误边界：内部抛错就地显示并落盘。
{
  const brokenStore = {
    getSnapshot: () => {
      throw new Error('boom-in-getSnapshot')
    },
    subscribe: () => () => {},
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(LiangSeat, {
      locked: false,
      available: true,
      directory: brokenStore,
      load: () => {},
      select: () => Promise.resolve(false),
    }))
  })
  check((container.textContent ?? '').includes('校准器内部错误'), '错误边界应就地显示错误')
  const stored = dom.window.localStorage.getItem('liang-calibrator:errors')
  check(typeof stored === 'string' && stored.includes('boom-in-getSnapshot'), `错误应写入 localStorage，实际：${stored}`)
  console.log('scenario 8 (error boundary): ok')
}

// 9) 滑动：全屏背景图出现，停手 5 秒后淡出。
{
  const { container } = await mount(CATALOG)
  const input = container.querySelector('input.ls-range')
  await typeInto(input, '3')

  const wallpaper = document.querySelector('.ls-wallpaper')
  check(wallpaper !== null, '滑动后应创建全屏背景图层')
  check(wallpaper?.classList.contains('ls-wallpaper-on') === true, '滑动时背景图应可见')
  const sharp = wallpaper?.querySelector('.ls-wallpaper-sharp')
  check((sharp?.getAttribute('src') ?? '').startsWith('data:image/webp'), '背景图应指向当前帧')
  check(wallpaper?.querySelector('.ls-wallpaper-scrim') !== null, '背景图应带压暗层')

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5400))
  })
  check(wallpaper?.classList.contains('ls-wallpaper-on') === false, '5 秒后背景图应淡出')
  console.log('scenario 9 (wallpaper): ok')
}

// 10) 插槽注入面绝不能抛错。
{
  const seatInject = createSeatInject({
    sessions: {
      subagentAddress: () => {
        throw new Error('no-binding')
      },
    },
    modelDirectories: {
      directoryFor: () => {
        throw new Error('resolved no scope')
      },
    },
  })
  let face = null
  let thrown = null
  try {
    face = seatInject('session-x')
  } catch (error) {
    thrown = error
  }
  check(thrown === null, `inject 不得抛错，实际抛出：${thrown?.message}`)
  check(face?.available === true, 'available 解析失败时应保守取 true')
  let storeThrown = null
  try {
    face.directory.subscribe(() => {})
    face.directory.getSnapshot()
    face.load()
    await face.select({ provider: 'p', model: 'm' })
  } catch (error) {
    storeThrown = error
  }
  check(storeThrown === null, `退化目录不得抛错，实际：${storeThrown?.message}`)
  console.log('scenario 10 (defensive inject): ok')
}

// 11) 锁定：禁用并说明原因。
{
  const { container } = await mount(CATALOG, { locked: true })
  check(container.querySelector('input.ls-range').disabled === true, 'locked 时滑杆应禁用')
  check((container.textContent ?? '').includes('本会话已锁定'), '应说明锁定原因')
  console.log('scenario 11 (locked): ok')
}

// 12) 目录报错：禁用 + 原因 + 重试。
{
  const { container } = await mount({ current: null, routable: null, groups: [], failures: [], status: 'error', pending: null, error: null })
  check(container.querySelector('input.ls-range').disabled === true, '目录报错时滑杆应禁用')
  check((container.textContent ?? '').includes('模型目录'), '应说明目录原因')
  check(container.querySelector('.ls-retry') !== null, '应提供重试入口')
  console.log('scenario 12 (catalog error): ok')
}

// 13) 自愈：首次加载失败后自动重试，目录到手即恢复可用。
{
  let calls = 0
  const dir = createDirectory({ current: null, routable: null, groups: [], failures: [], status: 'error', pending: null, error: null })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const loadOnce = () => {
    calls += 1
    if (calls >= 2) dir.set(CATALOG)
  }
  await act(async () => {
    root.render(React.createElement(LiangCalibrator, {
      locked: false,
      available: true,
      directory: dir.store,
      load: loadOnce,
      select: (selection) => dir.select(selection).then((r) => r.ok !== false),
    }))
  })
  const trigger = container.querySelector('.ls-trigger')
  await click(trigger)
  check(container.querySelector('input.ls-range').disabled === true, '第一次失败时仍应禁用')
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2600))
  })
  check(calls >= 2, `应自动重试，实际只调用了 ${calls} 次`)
  check(container.querySelector('input.ls-range').disabled === false, `目录到手后应恢复可用（调用 ${calls} 次）`)
  console.log(`scenario 13 (self-healing catalog): load calls=${calls}`)
}

// 14) 变阻器外观：器件齐备，滑片与通电段跟随取值。
{
  const { container } = await mount(CATALOG)
  for (const selector of ['.ls-rod', '.ls-tube', '.ls-windings', '.ls-coil-live', '.ls-wiper', '.ls-wiper-plate', '.ls-wiper-wedge', '.ls-wiper-tip', '.ls-plate-left', '.ls-plate-right', '.ls-base']) {
    check(container.querySelector(selector) !== null, `缺少变阻器部件 ${selector}`)
  }
  check(container.querySelectorAll('.ls-plate-post').length === 2, '两块端板各有一个横向接线柱')
  check(container.querySelectorAll('.ls-post').length === 2, '瓷管两端应有两个红色接线柱')

  const input = container.querySelector('input.ls-range')
  const wiper = container.querySelector('.ls-wiper')
  const live = container.querySelector('.ls-coil-live')
  const initial = Number.parseFloat(wiper.style.left)
  check(Number.isFinite(initial) && initial > 0 && initial < 100, `初始滑片位置应为区间代表档，实际 ${wiper.style.left}`)
  check(Number.parseFloat(live.style.width) === initial, '通电段宽度应与滑片位置一致')

  await typeInto(input, '15')
  check(wiper.style.left === '100%', `+15 时滑片应在右端，实际 ${wiper.style.left}`)
  check(live.style.width === '100%', `+15 时通电段应满，实际 ${live.style.width}`)
  await typeInto(input, '-15')
  check(wiper.style.left === '0%', `-15 时滑片应在左端，实际 ${wiper.style.left}`)
  console.log('scenario 14 (rheostat look): ok')
}

// 15) 折叠 / 展开 / 关闭：默认只有一个三角按钮，✕ 关闭，且悬停不再弹图片预览。
{
  const { container } = await mount(CATALOG, {}, { expand: false })
  check(container.querySelector('.ls-trigger') !== null, '默认应只有一个三角按钮')
  check(container.querySelector('.ls-range') === null, '未展开时不应渲染滑杆')
  check(container.querySelector('.ls-tri').textContent === '▸', '折叠时三角应朝右')

  await click(container.querySelector('.ls-trigger'))
  check(container.querySelector('.ls-popover') !== null, '点击三角应展开悬浮面板')
  check(container.querySelector('.ls-range') !== null, '展开后应出现滑杆')
  check(container.querySelector('.ls-tri').textContent === '▾', '展开时三角应朝下')
  check(container.querySelector('.ls-close') !== null, '悬浮面板右上角应有关闭按钮')

  // 悬停不再有图片预览。
  await act(async () => {
    container.querySelector('.ls-rheostat').dispatchEvent(new dom.window.MouseEvent('mouseenter', { bubbles: false }))
  })
  check(document.querySelector('.ls-banner') === null, '悬停不应再出现图片预览横幅')

  await click(container.querySelector('.ls-close'))
  check(container.querySelector('.ls-popover') === null, '点 ✕ 应关闭悬浮面板')
  console.log('scenario 15 (collapse / expand / close): ok')
}

// 16) 设置：三列都能手填，写入本机并用于该状态的提交。
{
  const { container, dir } = await mount(CATALOG)
  check(container.querySelector('.ls-settings') === null, '默认显示滑杆视图')

  await click(container.querySelector('.ls-gear'))
  const settings = container.querySelector('.ls-settings')
  check(settings !== null, '点齿轮应切到档位设置')
  const rows = settings.querySelectorAll('.ls-settings-row')
  check(rows.length === 6, '应为六个状态各一行')
  check(rows[0].querySelectorAll('input').length === 3, '每行应有 provider / 模型 / 强度三个输入框')

  // 手填一条目录里没有的路由（模拟接自己的 API）。
  const [providerInput, modelInput, effortInput] = rows[0].querySelectorAll('input')
  await typeInto(providerInput, 'my-api')
  await typeInto(modelInput, 'vendor/model-x')
  await typeInto(effortInput, 'max')

  const stored = JSON.parse(dom.window.localStorage.getItem('liang-calibrator:stages') ?? 'null')
  check(stored?.stages?.[0]?.provider === 'my-api' && stored?.stages?.[0]?.model === 'vendor/model-x' && stored?.stages?.[0]?.effort === 'max',
    `设置应持久化，实际 ${JSON.stringify(stored?.stages?.[0])}`)
  check(rows[0].dataset.unknown === 'true', '目录里没有的 provider 应标记为未知')

  // 回到滑杆视图，拖到该状态区间应提交手填的路由。
  await click(container.querySelector('.ls-gear'))
  const input = container.querySelector('input.ls-range')
  await typeInto(input, '-13')
  const submitted = dir.selections.at(-1)
  check(submitted?.provider === 'my-api', `应提交手填的 provider，实际 ${JSON.stringify(submitted)}`)
  check(submitted?.model === 'vendor/model-x', `应提交手填的模型，实际 ${submitted?.model}`)
  check(submitted?.reasoningEffort === 'max', `应提交手填的强度，实际 ${submitted?.reasoningEffort}`)

  // 全部自动。
  await click(container.querySelector('.ls-gear'))
  await click(container.querySelector('.ls-settings-clear'))
  const cleared = JSON.parse(dom.window.localStorage.getItem('liang-calibrator:stages') ?? 'null')
  check(
    Array.isArray(cleared?.stages) && cleared.stages.every((entry) => entry === null)
    && Array.isArray(cleared?.frames) && cleared.frames.every((entry) => entry === null),
    `「全部自动」应清空两层设置，实际 ${JSON.stringify(cleared)}`,
  )
  console.log('scenario 16 (settings by stage): ok')
}

// 17) 按档位 31：逐档覆盖，且优先于按状态。
{
  const { container, dir } = await mount(CATALOG)
  await click(container.querySelector('.ls-gear'))
  const modes = container.querySelectorAll('.ls-mode-btn')
  check(modes.length === 4, `应有「按状态 6 / 按档位 31 / 名字 31 / 背图 31」四个粒度，实际 ${modes.length}`)
  check(container.querySelectorAll('.ls-settings-row').length === 6, '默认按状态显示 6 行')

  await click(modes[1])
  const rows = container.querySelectorAll('.ls-settings-row')
  check(rows.length === 31, `按档位模式应有 31 行，实际 ${rows.length}`)
  check(rows[0].querySelector('.ls-settings-stage').textContent === '-15', '第一行应是 -15')
  check(rows[15].querySelector('.ls-settings-stage').textContent === '00', '第 16 行应是 00')
  check(rows[30].querySelector('.ls-settings-stage').textContent === '+15', '最后一行应是 +15')
  check((rows[30].querySelectorAll('input')[1].getAttribute('placeholder') ?? '') === 'deepseek-v4-pro',
    '占位符应提示该档自动会选的模型')

  // 只覆盖 +15 这一档。
  const [providerInput, modelInput, effortInput] = rows[30].querySelectorAll('input')
  await typeInto(providerInput, 'my-api')
  await typeInto(modelInput, 'only-top')
  await typeInto(effortInput, 'max')

  await click(container.querySelector('.ls-gear'))
  const input = container.querySelector('input.ls-range')
  await typeInto(input, '15')
  const top = dir.selections.at(-1)
  check(top?.provider === 'my-api' && top?.model === 'only-top' && top?.reasoningEffort === 'max',
    `+15 应使用逐档覆盖，实际 ${JSON.stringify(top)}`)

  await typeInto(input, '14')
  const neighbour = dir.selections.at(-1)
  check(neighbour?.model !== 'only-top', `相邻档位不应受影响，实际 ${JSON.stringify(neighbour)}`)

  const stored = JSON.parse(dom.window.localStorage.getItem('liang-calibrator:stages') ?? 'null')
  check(stored?.frames?.[30]?.model === 'only-top', `逐档设置应存在 frames 里，实际 ${JSON.stringify(stored?.frames?.[30])}`)
  console.log('scenario 17 (per-frame overrides): ok')
}

// 18) 名字 31：逐档改名、相邻同名合并、站名行 / 芯片 / 无障碍文案都跟着变。
{
  dom.window.localStorage.removeItem('liang-calibrator:stages')
  dom.window.localStorage.removeItem('liang-calibrator:names')
  const { container, dir } = await mount(CATALOG)
  await click(container.querySelector('.ls-gear'))
  const modes = container.querySelectorAll('.ls-mode-btn')
  await click(modes[2])

  const rows = container.querySelectorAll('.ls-settings-row-name')
  check(rows.length === 31, `名字模式应有 31 行，实际 ${rows.length}`)
  const input30 = rows[30].querySelector('input')
  check(input30.getAttribute('placeholder') === '梁祖', `占位符应是默认梁名，实际 ${input30.getAttribute('placeholder')}`)
  await typeInto(input30, '梁帝')
  await typeInto(rows[29].querySelector('input'), '梁帝')
  const storedNames = JSON.parse(dom.window.localStorage.getItem('liang-calibrator:names') ?? 'null')
  check(storedNames?.[30] === '梁帝', `名字应写入 localStorage，实际 ${JSON.stringify(storedNames?.[30])}`)

  await click(container.querySelector('.ls-gear'))
  const rangeInput = container.querySelector('input.ls-range')
  await typeInto(rangeInput, '15')
  const labels = [...container.querySelectorAll('.ls-station')].map((node) => node.textContent)
  check(labels.length === 6, `+14 / +15 同名合并后仍应是 6 段，实际 ${labels.length}：${labels.join('/')}`)
  check(labels.includes('梁帝'), `站名行应出现自定义名，实际 ${labels.join('/')}`)
  check(container.querySelector('.ls-station-active')?.textContent === '梁帝', '当前段应高亮自定义名')
  check((rangeInput.getAttribute('aria-valuetext') ?? '').includes('梁帝'), '无障碍文案应使用自定义名')

  await act(async () => {
    dir.set({ ...CATALOG, current: { provider: 'deepseek-account', model: 'deepseek-v4-pro', reasoningEffort: 'max' } })
  })
  check((container.querySelector('.ls-stage')?.textContent ?? '') === '梁帝', '芯片按当前选择显示自定义名')

  dom.window.localStorage.removeItem('liang-calibrator:names')
  console.log('scenario 18 (custom names): ok')
}

// 19) 全部 31 档同名：站名行只剩一段（可以几个档位同一个名字）。
{
  dom.window.localStorage.setItem('liang-calibrator:names', JSON.stringify(new Array(31).fill('梁')))
  const { container } = await mount(CATALOG)
  const labels = container.querySelectorAll('.ls-station')
  check(labels.length === 1, `全部同名应只剩一段，实际 ${labels.length}`)
  check(labels[0]?.textContent === '梁', `段名应为自定义名，实际 ${labels[0]?.textContent}`)
  dom.window.localStorage.removeItem('liang-calibrator:names')
  console.log('scenario 19 (one name for the whole ladder): ok')
}

// 20) 背图 31：逐档指定自定义图，滑到该档铺自定义图，清除后回退内置图。
{
  dom.window.localStorage.removeItem('liang-calibrator:images')
  const { container } = await mount(CATALOG)
  await click(container.querySelector('.ls-gear'))
  await click(container.querySelectorAll('.ls-mode-btn')[3])
  const rows = container.querySelectorAll('.ls-settings-row-image')
  check(rows.length === 31, `背图模式应有 31 行，实际 ${rows.length}`)
  check(rows[0].querySelector('.ls-settings-empty') !== null, '未指定时占位应显示「内置」')

  const fileInput = rows[30].querySelector('input[type="file"]')
  check(fileInput !== null, '每行应有选图入口')
  const file = new dom.window.File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'custom.png', { type: 'image/png' })
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
  await act(async () => {
    fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  const storedImages = JSON.parse(dom.window.localStorage.getItem('liang-calibrator:images') ?? 'null')
  check(typeof storedImages?.[30] === 'string' && storedImages[30] !== '', `背图映射应持久化，实际 ${JSON.stringify(storedImages?.[30])}`)
  check(container.querySelectorAll('.ls-settings-row-image')[30].querySelector('.ls-settings-thumb') !== null, '指定后应显示缩略图')

  await click(container.querySelector('.ls-gear'))
  const rangeInput = container.querySelector('input.ls-range')
  await typeInto(rangeInput, '15')
  const sharp = document.querySelector('.ls-wallpaper.ls-wallpaper-on')?.querySelector('.ls-wallpaper-sharp')
  check((sharp?.getAttribute('src') ?? '').startsWith('blob:'), `+15 应铺自定义图，实际 ${(sharp?.getAttribute('src') ?? '(none)').slice(0, 30)}`)

  await typeInto(rangeInput, '10')
  check((sharp?.getAttribute('src') ?? '').startsWith('data:image/webp'), '其它档仍是内置档位图')

  await click(container.querySelector('.ls-gear'))
  await click(container.querySelectorAll('.ls-settings-row-image')[30].querySelector('.ls-settings-btn-clear'))
  const clearedImages = JSON.parse(dom.window.localStorage.getItem('liang-calibrator:images') ?? 'null')
  check(clearedImages?.[30] === null, `清除后映射应为空，实际 ${JSON.stringify(clearedImages?.[30])}`)

  await click(container.querySelector('.ls-gear'))
  await typeInto(container.querySelector('input.ls-range'), '15')
  const sharpAfter = document.querySelector('.ls-wallpaper.ls-wallpaper-on')?.querySelector('.ls-wallpaper-sharp')
  check((sharpAfter?.getAttribute('src') ?? '').startsWith('data:image/webp'), '清除后应回退内置图')
  dom.window.localStorage.removeItem('liang-calibrator:images')
  console.log('scenario 20 (custom backgrounds): ok')
}

// 21) 名字多到挤不下：站名行自动省略，当前档永远保留。
{
  const names = Array.from({ length: 31 }, (_, index) => `档${index}`)
  dom.window.localStorage.setItem('liang-calibrator:names', JSON.stringify(names))
  const { container } = await mount(CATALOG)
  const labels = container.querySelectorAll('.ls-station')
  check(labels.length > 3 && labels.length < 31, `31 个不同名应部分省略，实际 ${labels.length}`)
  check(container.querySelector('.ls-station-active') !== null, '当前档标签必须保留')
  dom.window.localStorage.removeItem('liang-calibrator:names')
  console.log(`scenario 21 (dense names): ${labels.length}/31 labels kept`)
}

await rm('./.client.test.cjs', { force: true })

if (failures.length > 0) {
  console.error(`FAILED (${failures.length}):\n` + failures.join('\n'))
  process.exit(1)
}
console.log('render OK: component mounts, commits selections and degrades gracefully')
