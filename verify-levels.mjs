// 校验 31 档映射与梯子生成（把构建期注入的 __LIANG_IMG_n__ 占位符替换为空串后直接跑源码）。
import { readFile, writeFile, rm } from 'node:fs/promises'

const src = await readFile('./src/levels.js', 'utf8')
const patched = src.replace(/__LIANG_IMG_\d+__/gu, '""')
await writeFile('./.levels.test.mjs', patched)
const m = await import('./.levels.test.mjs')
await rm('./.levels.test.mjs')

const fail = []
const eq = (actual, expected, what) => {
  if (actual !== expected) fail.push(`${what}: expected ${expected}, got ${actual}`)
}
const ok = (condition, what) => {
  if (!condition) fail.push(what)
}
const combos = (ladder) => new Set(ladder.map((c) => `${c.modelId}/${c.effort ?? 'default'}`))
const order = (combo) => {
  const tier = m.MODEL_TIERS.indexOf(combo.modelId)
  const rank = { off: 0, low: 1, high: 2, max: 3 }
  return tier * 10 + (combo.effort === undefined ? 0 : rank[combo.effort] + 1)
}

eq(m.MIN_SCORE, -15, 'MIN_SCORE')
eq(m.MAX_SCORE, 15, 'MAX_SCORE')
eq(m.SCORE_COUNT, 31, 'SCORE_COUNT')
eq(m.FRAMES.length, 31, 'FRAMES.length')
eq(m.STAGES.length, 6, 'STAGES.length')
eq(m.MODEL_TIERS.length, 3, 'MODEL_TIERS.length')

for (let score = -15; score <= 15; score += 1) eq(m.frameIndexFor(score), score + 15, `frameIndexFor(${score})`)
for (let frame = 0; frame < 31; frame += 1) eq(m.scoreOfFrame(frame), frame - 15, `scoreOfFrame(${frame})`)

// 每 6 档一个状态，最高档单独构成梁祖（与原项目 describeScore 一致）。
const boundaries = [[0, 0], [5, 0], [6, 1], [11, 1], [12, 2], [17, 2], [18, 3], [23, 3], [24, 4], [29, 4], [30, 5]]
for (const [frame, stage] of boundaries) eq(m.stageIndexFor(frame), stage, `stageIndexFor(${frame})`)
eq(m.firstFrameOfStage(3), 18, 'firstFrameOfStage(3)')
eq(m.lastFrameOfStage(5), 30, 'lastFrameOfStage(5)')

eq(m.formatSignedScore(0), '00', 'format 0')
eq(m.formatSignedScore(7), '+07', 'format +7')
eq(m.formatSignedScore(-12), '-12', 'format -12')

// 三个模型都在：六条状态带平均分成三段，共 12 种组合。
const THREE = m.MODEL_TIERS
const four = () => ['off', 'low', 'high', 'max']
const three = m.buildLadder(THREE, four)
eq(three.length, 31, 'three-tier ladder length')
eq(three[0].modelId, 'deepseek-flash', 'three[0] model')
eq(three[0].effort, 'off', 'three[0] effort')
eq(three[11].modelId, 'deepseek-flash', 'three[11] 仍在第一段')
eq(three[12].modelId, 'deepseek/deepseek-v4.1-flash', 'three[12] 进入第二段 (cmd)')
eq(three[23].modelId, 'deepseek/deepseek-v4.1-flash', 'three[23] 仍在第二段')
eq(three[24].modelId, 'deepseek-v4-pro', 'three[24] 进入第三段')
eq(three[30].modelId, 'deepseek-v4-pro', 'three[30] model')
eq(three[30].effort, 'max', 'three[30] effort')
eq(combos(three).size, 12, '三个模型四等级 = 12 种组合')
for (let frame = 1; frame < 31; frame += 1) {
  ok(order(three[frame]) >= order(three[frame - 1]), `three-tier 单调递增 @${frame}`)
}

// 只有 flash/pro（cmd 未配置）：退回原来的 3+3 分法，共 8 种组合。
const two = m.buildLadder(['deepseek-flash', 'deepseek-v4-pro'], four)
eq(two[17].modelId, 'deepseek-flash', 'two-tier 第一段到帧 17')
eq(two[18].modelId, 'deepseek-v4-pro', 'two-tier 第二段从帧 18 起')
eq(combos(two).size, 8, '两个模型四等级 = 8 种组合')

// 只配置了 cmd：31 档全给它。
const one = m.buildLadder(['deepseek/deepseek-v4.1-flash'], four)
eq(combos(one).size, 4, '单模型四等级 = 4 种组合')
ok(one.every((c) => c.modelId === 'deepseek/deepseek-v4.1-flash'), '单模型时 31 档都归它')

// 模型明确不公布推理等级：该段只提交模型本身，不带 reasoningEffort。
const noReasoning = m.buildLadder(['deepseek-flash', 'deepseek-v4-pro'], (id) => (id === 'deepseek-v4-pro' ? [] : four()))
ok(noReasoning.filter((c) => c.modelId === 'deepseek-v4-pro').every((c) => c.effort === undefined), '无等级模型不带 effort')
ok(noReasoning.filter((c) => c.modelId === 'deepseek-flash').every((c) => c.effort !== undefined), '有等级模型仍带 effort')

// 未知模型（目录还没到）用兜底等级占位；空 tiers 退回 MODEL_TIERS。
const unknown = m.buildLadder(THREE, () => undefined)
eq(combos(unknown).size, 12, '未知时用兜底等级占位')
eq(m.buildLadder([], four)[0].modelId, 'deepseek-flash', '空 tiers 退回 MODEL_TIERS')

// 只公布 off/high/max 的目录：每段 3 个等级。
const legacy = m.buildLadder(['deepseek-flash', 'deepseek-v4-pro'], () => ['off', 'high', 'max'])
eq(combos(legacy).size, 6, '三个等级时 6 种组合')
eq(legacy[0].effort, 'off', 'legacy[0]')
eq(legacy[30].effort, 'max', 'legacy[30]')

if (fail.length > 0) {
  console.error(`FAILED (${fail.length}):\n` + fail.join('\n'))
  process.exit(1)
}
console.log('levels OK: 31 frames / 6 stages / tiered dynamic ladder (cmd included, degrades when absent)')
