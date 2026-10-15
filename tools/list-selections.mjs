// 列出会话日志里的 model/selection 事件（provider / model / effort + 时间）。
// 用法：node tools/list-selections.mjs <session.v4.jsonl.zstd> [tail]
import { readFile } from 'node:fs/promises'
import { zstdDecompressSync } from 'node:zlib'

const file = process.argv[2]
const tail = Number(process.argv[3] ?? 20)

const raw = await readFile(file)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []
for (let at = raw.indexOf(MAGIC); at !== -1; at = raw.indexOf(MAGIC, at + 4)) starts.push(at)
starts.push(raw.length)

let text = ''
for (let index = 0; index < starts.length - 1; index += 1) {
  try {
    text += zstdDecompressSync(raw.subarray(starts[index], starts[index + 1])).toString('utf8')
  } catch {
    // 跳过坏帧
  }
}

const rows = []
for (const line of text.split('\n')) {
  if (!line.includes('"model/selection"')) continue
  try {
    const value = JSON.parse(line)
    const data = value.data ?? {}
    const selection = data.selection ?? data.next ?? data
    rows.push({
      seq: value.seq,
      time: new Date(value.time).toISOString().replace('T', ' ').slice(0, 19),
      provider: selection.provider ?? data.provider,
      model: selection.model ?? data.model,
      effort: selection.reasoningEffort ?? data.reasoningEffort ?? '(默认)',
    })
  } catch {
    // 忽略
  }
}

console.log(`共 ${rows.length} 条 model/selection，最后 ${tail} 条：`)
for (const row of rows.slice(-tail)) {
  console.log(`#${row.seq}  ${row.time}  ${row.provider} / ${row.model} / ${row.effort}`)
}
