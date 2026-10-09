/**
 * 滑动变祖器 31 档映射表。
 *
 * 视觉语义与原项目 Lichtspektrum/liang-intensity-calibrator 的 `src/score-domain.ts`
 * 一致：滑杆取值 -15..+15 共 31 档，每 6 档一个梁系状态，最高档单独构成「梁祖」，
 * 每一档对应一张关键帧图。
 *
 * 强度语义（哪一档真正选中哪个模型 / 推理等级）由 {@link buildLadder} 按当前模型目录
 * 动态生成，两条规则：
 *
 * 1. **模型分档**：按 {@link MODEL_TIERS} 的顺序（由弱到强）把六个状态带平均切成若干段，
 *    每一段用一个模型。目录里不存在的模型会被跳过，帧区间自动重新平均分给剩下的模型，
 *    因此某个 provider 下线只会让梯子变短，不会让滑杆失效。
 * 2. **推理等级**：每个模型覆盖的那段帧，按该模型在目录里公布的推理等级**均分**，
 *    从弱到强单调递增。模型明确公布「没有任何推理等级」时，这一段只提交模型本身
 *    （不带 reasoningEffort），不会凭空捏造等级。
 *
 * 同一组合会占据连续若干档：档位在区间内变化只换画面、不重复发请求。
 *
 * FRAMES 是构建期由 build.mjs 通过 esbuild define 注入的 webp data URL
 * （素材取自原项目的 public/frames/frame-00..30.webp）。
 */

export const MIN_SCORE = -15
export const MAX_SCORE = 15
export const SCORE_COUNT = MAX_SCORE - MIN_SCORE + 1
export const SCORES_PER_STAGE = 6

/** 31 张档位图，索引 = score - MIN_SCORE = 帧序号。 */
export const FRAMES = Object.freeze([
  __LIANG_IMG_0__,
  __LIANG_IMG_1__,
  __LIANG_IMG_2__,
  __LIANG_IMG_3__,
  __LIANG_IMG_4__,
  __LIANG_IMG_5__,
  __LIANG_IMG_6__,
  __LIANG_IMG_7__,
  __LIANG_IMG_8__,
  __LIANG_IMG_9__,
  __LIANG_IMG_10__,
  __LIANG_IMG_11__,
  __LIANG_IMG_12__,
  __LIANG_IMG_13__,
  __LIANG_IMG_14__,
  __LIANG_IMG_15__,
  __LIANG_IMG_16__,
  __LIANG_IMG_17__,
  __LIANG_IMG_18__,
  __LIANG_IMG_19__,
  __LIANG_IMG_20__,
  __LIANG_IMG_21__,
  __LIANG_IMG_22__,
  __LIANG_IMG_23__,
  __LIANG_IMG_24__,
  __LIANG_IMG_25__,
  __LIANG_IMG_26__,
  __LIANG_IMG_27__,
  __LIANG_IMG_28__,
  __LIANG_IMG_29__,
  __LIANG_IMG_30__,
])

/** 六个梁系状态，顺序与原项目 STAGES 一致（只描述画面分带）。 */
export const STAGES = Object.freeze(['小难梁', '牢梁', '梁子', '梁圣', '梁神', '梁祖'])

/**
 * 参与梯子的模型，按「梁系强度」从弱到强排列。
 *
 * 六条状态带会平均分给这里**实际存在**的模型：3 个都在时每段 2 条状态带
 * （帧 0-11 / 12-23 / 24-30），只有前两个时是 3+3（帧 0-17 / 18-30），
 * 只有一个模型时 31 档全给它。改顺序或增删模型只改这一个数组。
 */
export const MODEL_TIERS = Object.freeze([
  'deepseek-flash',
  'deepseek/deepseek-v4.1-flash',
  'deepseek-v4-pro',
])

/** 目录尚未公布推理等级时的兜底顺序（与 dsh-llm-deepseek 的默认集合一致）。 */
export const FALLBACK_EFFORTS = Object.freeze(['off', 'low', 'high', 'max'])

export function clampScore(score) {
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(score)))
}

/** score -> 帧索引 0..30。 */
export function frameIndexFor(score) {
  return clampScore(score) - MIN_SCORE
}

/** 帧索引 -> score。 */
export function scoreOfFrame(frame) {
  return clampScore(frame + MIN_SCORE)
}

/** 帧索引 -> 状态索引 0..5。 */
export function stageIndexFor(frame) {
  return Math.min(STAGES.length - 1, Math.floor(frameIndexFor(scoreOfFrame(frame)) / SCORES_PER_STAGE))
}

/** 某个状态占据的最后一帧。 */
export function lastFrameOfStage(stageIndex) {
  return Math.min(SCORE_COUNT - 1, stageIndex * SCORES_PER_STAGE + SCORES_PER_STAGE - 1)
}

/** 某个状态占据的第一帧。 */
export function firstFrameOfStage(stageIndex) {
  return Math.min(SCORE_COUNT - 1, stageIndex * SCORES_PER_STAGE)
}

/** 与原项目一致的带符号分值显示，例如 +07 / -12 / 00。 */
export function formatSignedScore(score) {
  const rounded = clampScore(score)
  if (rounded === 0) return '00'
  const magnitude = String(Math.abs(rounded)).padStart(2, '0')
  return rounded > 0 ? `+${magnitude}` : `-${magnitude}`
}

/**
 * 归一化目录公布的推理等级。
 *
 * - 传入数组：去重保序，**空数组保持为空**（表示该模型不设置推理等级）；
 * - 传入 undefined/null（模型还没解析出来）：用兜底集合，只为渲染占位。
 */
export function normalizeEfforts(efforts) {
  if (!Array.isArray(efforts)) return [...FALLBACK_EFFORTS]
  const ids = []
  for (const effort of efforts) {
    const id = typeof effort === 'string' ? effort : effort?.id
    if (typeof id === 'string' && id !== '' && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * 生成 31 档梯子：每档给出 { modelId, effort }，effort 可能是 undefined
 * （该模型不设置推理等级）。
 *
 * @param tiers - 参与梯子的模型 id，按由弱到强排列；空数组时退回 {@link MODEL_TIERS} 占位。
 * @param effortsFor - 按模型 id 读取目录公布的推理等级；返回 undefined 表示未知，[] 表示不设置。
 * @returns 长度 31 的数组，索引即帧序号。
 */
export function buildLadder(tiers, effortsFor) {
  const active = Array.isArray(tiers) && tiers.length > 0 ? tiers : [...MODEL_TIERS]
  const ladder = new Array(SCORE_COUNT)
  const bands = STAGES.length
  for (let tier = 0; tier < active.length; tier += 1) {
    const firstStage = Math.floor((tier * bands) / active.length)
    const lastStage = Math.floor(((tier + 1) * bands) / active.length) - 1
    if (lastStage < firstStage) continue
    const start = firstStage === 0 ? 0 : lastFrameOfStage(firstStage - 1) + 1
    const end = lastFrameOfStage(lastStage)
    const frames = end - start + 1
    const efforts = normalizeEfforts(effortsFor(active[tier]))
    for (let offset = 0; offset < frames; offset += 1) {
      const index = Math.floor((offset * efforts.length) / frames)
      const effort = efforts.length === 0 ? undefined : efforts[Math.min(efforts.length - 1, index)]
      ladder[start + offset] = effort === undefined
        ? { modelId: active[tier], effort: undefined }
        : { modelId: active[tier], effort }
    }
  }
  return ladder
}

export function comboKey(combo) {
  return combo === undefined ? '' : `${combo.modelId}/${combo.effort ?? 'default'}`
}
