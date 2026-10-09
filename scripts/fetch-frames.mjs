// 从上游项目抓取 31 张档位关键帧到 assets/。
//
// 上游 README 声明 `public/frames` 的人像素材不随 MIT 协议共享，因此本仓库不收录这些图片，
// 只在构建前按需抓取；如果你要再分发这些素材，请先自行确认相关权利。
//
// 用法：node scripts/fetch-frames.mjs [--force]
import { mkdir, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'assets')
const COUNT = 31
const SOURCE = 'https://raw.githubusercontent.com/Lichtspektrum/liang-intensity-calibrator/main/public/frames'
const force = process.argv.includes('--force')

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

await mkdir(ASSETS, { recursive: true })
let downloaded = 0
let skipped = 0

for (let index = 0; index < COUNT; index += 1) {
  const name = `frame-${String(index).padStart(2, '0')}.webp`
  const target = join(ASSETS, name)
  if (!force && await exists(target)) {
    skipped += 1
    continue
  }
  const response = await fetch(`${SOURCE}/${name}`)
  if (!response.ok) {
    console.error(`抓取失败：${name} → HTTP ${response.status}`)
    process.exit(1)
  }
  await writeFile(target, Buffer.from(await response.arrayBuffer()))
  downloaded += 1
  process.stdout.write(`\r已下载 ${downloaded + skipped}/${COUNT}`)
}

console.log(`\n完成：新下载 ${downloaded} 张，已存在 ${skipped} 张（目录 ${ASSETS}）`)
if (downloaded === 0 && skipped === 0) {
  console.error('没有可用素材，请检查网络或上游仓库。')
  process.exit(1)
}
