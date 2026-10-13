// 校验 31 档映射与梯子生成（把构建期注入的 __LIANG_IMG_n__ 占位符替换为空串后直接跑源码）。
import { readFile, writeFile, rm } from 'node:fs/promises'
import { build } from 'esbuild'

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

// 名字分段与背图映射的纯逻辑：labels.js 经 esbuild 注入图片占位符后加载。
await rm('./.pure.test', { recursive: true, force: true })
await build({
  entryPoints: ['./src/labels.js', './src/gallery.js'],
  outdir: './.pure.test',
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
  define: Object.fromEntries(
    Array.from({ length: 31 }, (_, index) => [`__LIANG_IMG_${index}__`, JSON.stringify('')]),
  ),
})
const labels = await import('./.pure.test/labels.js')
const gallery = await import('./.pure.test/gallery.js')
await rm('./.pure.test', { recursive: true, force: true })

const defaults = labels.defaultNames()
eq(defaults.length, 31, 'defaultNames.length')
eq(defaults[0], '小难梁', 'defaultNames[0]')
eq(defaults[5], '小难梁', 'defaultNames[5]')
eq(defaults[6], '牢梁', 'defaultNames[6]')
eq(defaults[29], '梁神', 'defaultNames[29]')
eq(defaults[30], '梁祖', 'defaultNames[30]')

const defaultRuns = labels.nameRuns([])
eq(defaultRuns.length, 6, '默认名字应分成 6 段')
eq(defaultRuns[0].start, 0, '第一段起于帧 0')
eq(defaultRuns[0].end, 5, '第一段止于帧 5')
eq(defaultRuns[5].start, 30, '最后一段起于帧 30')
eq(labels.runCenter({ start: 0, end: 30 }), 0.5, 'runCenter 全段居中')
eq(labels.runCenter({ start: 30, end: 30 }), 1, 'runCenter 末帧到端点')
eq(labels.displayNameAt([], 28), '梁神', 'displayNameAt 回落默认梁名')

// 相邻同名合并：+14/+15 都叫「梁帝」→ 合成一段；跨段同名不合并。
const merged = labels.normalizeNames(defaults)
merged[29] = '梁帝'
merged[30] = '梁帝'
const mergedRuns = labels.nameRuns(merged)
eq(mergedRuns.length, 6, '合并后仍是 6 段')
eq(mergedRuns[5].start, 29, '合并段起于帧 29')
eq(mergedRuns[5].end, 30, '合并段止于帧 30')
eq(labels.displayNameAt(merged, 30), '梁帝', 'displayNameAt 自定义优先')

const split = labels.normalizeNames(defaults)
split[28] = '梁帝'
eq(labels.nameRuns(split).length, 8, '28 与 29 同名但不相邻（29 仍是梁神）→ 不合并，共 8 段')

// 规整规则。
eq(labels.normalizeNames(['  梁帝  '])[0], '梁帝', 'normalizeNames 去首尾空格')
eq(labels.normalizeNames([123])[0], '', 'normalizeNames 非字符串按空处理')
eq(labels.normalizeNames(['x'.repeat(80)])[0].length, labels.NAME_MAX_LENGTH, 'normalizeNames 截断过长')
eq(labels.normalizeNames(null).length, 31, 'normalizeNames 长度恒为 31')

// 标签密度：默认全可见；31 个不同名时省略，但当前档必须保留。
eq(labels.visibleRuns(defaultRuns, 0).length, 6, '默认名字应全部可见')
const denseRuns = labels.nameRuns(labels.normalizeNames(Array.from({ length: 31 }, (_, index) => `档${index}`)))
eq(denseRuns.length, 31, '31 个不同名 = 31 段')
const denseVisible = labels.visibleRuns(denseRuns, 4)
ok(denseVisible.length < 31 && denseVisible.length > 3, `密集名字应省略一部分，实际 ${denseVisible.length}`)
ok(denseVisible.some((run) => run.active && run.start <= 4 && run.end >= 4), '当前档的标签必须保留')
ok(labels.visibleRuns(denseRuns, 30).some((run) => run.active && run.end === 30), '末档的标签必须保留')

// 背图映射的规整。
eq(gallery.normalizeImageMap([]).length, 31, 'normalizeImageMap 长度恒为 31')
ok(gallery.normalizeImageMap([]).every((id) => id === null), '空输入全是 null')
eq(gallery.normalizeImageMap([' a ', '', 5])[0], 'a', 'normalizeImageMap 去空格')
eq(gallery.normalizeImageMap([' a ', '', 5])[1], null, 'normalizeImageMap 空串 → null')
eq(gallery.normalizeImageMap([' a ', '', 5])[2], null, 'normalizeImageMap 非字符串 → null')
eq(gallery.MAX_EDGE, 1920, 'MAX_EDGE')

if (fail.length > 0) {
  console.error(`FAILED (${fail.length}):\n` + fail.join('\n'))
  process.exit(1)
}
console.log('levels OK: 31 frames / 6 stages / tiered dynamic ladder (cmd included, degrades when absent)')
