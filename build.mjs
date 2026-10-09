import { build } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const pluginId = 'dsh-liang-calibrator'
const outDir = new URL('./lib/', import.meta.url)

process.env.NODE_ENV = 'production'

async function dataUrl(path) {
  const bytes = await readFile(path)
  return `data:image/webp;base64,${bytes.toString('base64')}`
}

// 31 张档位关键帧（滑动变祖器 frame-00..30）。
const FRAME_FILES = Array.from({ length: 31 }, (_, index) => String(index).padStart(2, '0'))
const images = await Promise.all(
  FRAME_FILES.map((n) => dataUrl(`./assets/frame-${n}.webp`)),
)
const defines = Object.fromEntries(
  images.map((url, index) => [`__LIANG_IMG_${index}__`, JSON.stringify(url)]),
)

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

// Host entry: plain ESM plugin module for the Loader.
const host = await build({
  entryPoints: ['./src/index.js'],
  outfile: './lib/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  minify: true,
  logLevel: 'warning',
})
if (host.errors.length > 0) {
  console.error(host.errors)
  process.exit(1)
}

// Browser half: CJS bundle with react external, wrapped in the web shell loader.
const client = await build({
  entryPoints: ['./src/client.jsx'],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2020',
  external: ['react'],
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  define: defines,
  minify: true,
  write: false,
  logLevel: 'warning',
})
if (client.errors.length > 0) {
  console.error(client.errors)
  process.exit(1)
}
const code = client.outputFiles[0].text
const externalModules = [...code.matchAll(/\brequire\("([^"]+)"\)/g)].map((m) => m[1])
const unsupported = externalModules.filter((id) => id !== 'react')
if (unsupported.length > 0) {
  throw new Error(`Unsupported Harness client modules: ${[...new Set(unsupported)].join(', ')}`)
}
const embeddedCount = code.match(/data:image\/webp;base64,/g)?.length ?? 0
if (embeddedCount !== 31) {
  throw new Error(`Expected 31 embedded stage frames, found ${embeddedCount}`)
}
const wrapped = [
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(pluginId)}, factory: (require) => {`,
  'var module = { exports: {} }; var exports = module.exports;',
  code,
  'return module.exports; } });',
  '',
].join('\n')
await writeFile(new URL('./client.js', outDir), wrapped)

console.log(`built lib/index.js and lib/client.js (${embeddedCount} frames embedded)`)
