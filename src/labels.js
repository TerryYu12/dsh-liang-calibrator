/**
 * 档位名字的纯逻辑：默认名、逐档覆盖、连续同名合并成段、标签排布。
 *
 * 名字层与路由层完全解耦：改名只影响显示（芯片、滑杆下方的站名行、无障碍文案），
 * 不改变任何提交语义。几个相邻档位写成同一个名字时，它们会合并成一段。
 */
import { SCORE_COUNT, STAGES, stageIndexFor } from './levels.js'

/** 单个名字允许的最大字符数（防畸长输入撑坏站名行）。 */
export const NAME_MAX_LENGTH = 24

/** 31 档的默认名：六个梁系状态每 6 档一段，最高档单独成段（与 STAGES 一致）。 */
export function defaultNames() {
  return Array.from({ length: SCORE_COUNT }, (_, frame) => STAGES[stageIndexFor(frame)])
}

/** 把任意输入规整为 31 个字符串：非字符串按空处理，去首尾空格并截断过长。 */
export function normalizeNames(raw) {
  return Array.from({ length: SCORE_COUNT }, (_, index) => {
    const value = Array.isArray(raw) ? raw[index] : undefined
    if (typeof value !== 'string') return ''
    return value.trim().slice(0, NAME_MAX_LENGTH)
  })
}

/** 第 frame 档的显示名：自定义名优先，否则回落到默认梁名。非有限数按首档处理。 */
export function displayNameAt(names, frame) {
  const index = Number.isFinite(frame) ? Math.min(SCORE_COUNT - 1, Math.max(0, Math.trunc(frame))) : 0
  const custom = Array.isArray(names) ? names[index] : undefined
  if (typeof custom === 'string' && custom.trim() !== '') return custom.trim()
  return STAGES[stageIndexFor(index)]
}

/** 把 31 档按显示名切成连续段：相邻且同名的档位合成一段。 */
export function nameRuns(names) {
  const runs = []
  for (let frame = 0; frame < SCORE_COUNT; frame += 1) {
    const name = displayNameAt(names, frame)
    const last = runs[runs.length - 1]
    if (last !== undefined && last.name === name) last.end = frame
    else runs.push({ start: frame, end: frame, name })
  }
  return runs
}

/** 段中心在轨道上的位置：0..1（帧 0 → 0，帧 30 → 1）。 */
export function runCenter(run) {
  return ((run.start + run.end) / 2) / (SCORE_COUNT - 1)
}

const LABEL_MAX_PX = 76
const LABEL_GAP_PX = 5
const TRACK_PX = 328

/** 粗略估计标签像素宽：CJK 近似全宽，字号与站名行一致（9.5px）。 */
function estimateLabelWidth(name) {
  return Math.min(LABEL_MAX_PX, [...String(name)].length * 9.5 + 6)
}

/**
 * 从连续段里挑出实际渲染的标签：从左往右贪心摆放，间距不足的段直接跳过，
 * 当前档所在的段永远保留（档位名字多到挤不下时，至少保证当前档可读）。
 *
 * @returns 每项 { start, end, name, center（0..1）, active }。
 */
export function visibleRuns(runs, activeFrame, trackPx = TRACK_PX) {
  const visible = []
  let lastRight = null
  const rightEdgeOf = (entry) => entry.center * trackPx + estimateLabelWidth(entry.name) / 2
  for (const run of runs) {
    const center = runCenter(run) * trackPx
    const half = estimateLabelWidth(run.name) / 2
    const isActive = activeFrame >= run.start && activeFrame <= run.end
    let fits = lastRight === null || center - half - lastRight >= LABEL_GAP_PX
    if (!fits && isActive) {
      // 当前档永远保留：从右往左丢掉与它重叠的已放置标签，为它腾出位置。
      while (visible.length > 0 && rightEdgeOf(visible[visible.length - 1]) + LABEL_GAP_PX > center - half) {
        visible.pop()
      }
      lastRight = visible.length === 0 ? null : rightEdgeOf(visible[visible.length - 1])
      fits = lastRight === null || center - half - lastRight >= LABEL_GAP_PX
    }
    if (!fits && !isActive) continue
    visible.push({ start: run.start, end: run.end, name: run.name, center: runCenter(run), active: isActive })
    lastRight = Math.max(lastRight ?? Number.NEGATIVE_INFINITY, center + half)
  }
  return visible
}
