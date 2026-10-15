// 从压缩的会话日志里找模型选择 / 不可用相关记录。
// 用法：node tools/scan-session.mjs <session.v4.jsonl.zstd> [pattern]
//
// 会话文件是"追加写的多帧 zstd"：按魔数切帧后逐帧解压，比流式解压更可靠。
import { readFile } from 'node:fs/promises'
import { zstdDecompressSync } from 'node:zlib'

const file = process.argv[2]
const pattern = new RegExp(process.argv[3] ?? 'modelSelection|selectModel|model-unavailable|unavailable', 'u')

const raw = await readFile(file)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []
for (let at = raw.indexOf(MAGIC); at !== -1; at = raw.indexOf(MAGIC, at + 4)) starts.push(at)
starts.push(raw.length)

let text = ''
for (let index = 0; index < starts.length - 1; index += 1) {
  const frame = raw.subarray(starts[index], starts[index + 1])
  try {
    text += zstdDecompressSync(frame).toString('utf8')
  } catch (error) {
    console.warn(`第 ${index + 1} 帧解压失败：${error.message}`)
  }
}
console.log(`文件 ${raw.length} 字节，${starts.length - 1} 帧，解出 ${text.length} 字符`)

const lines = text.split('\n').filter((line) => line.trim() !== '')
console.log(`共 ${lines.length} 行事件，匹配 ${pattern}：`)
let hits = 0
for (const line of lines) {
  if (!pattern.test(line)) continue
  hits += 1
  if (hits > 40) continue
  try {
    const value = JSON.parse(line)
    const type = value.type ?? value.kind ?? Object.keys(value).slice(0, 4).join(',')
    console.log(`#${hits} ${type}: ${JSON.stringify(value).slice(0, 420)}`)
  } catch {
    console.log(`#${hits} (raw) ${line.slice(0, 420)}`)
  }
}
console.log(`--- 命中 ${hits} 条 ---`)
