// 一次性探针：把加载 effect 换回旧写法（依赖 load 引用），验证它确实会陷入循环。
// 用来证明 render-test.mjs 的 scenario 7 不是空转的断言。
import { build } from 'esbuild'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

// 旧写法的循环会把更新链抛到 act() 之外：捕获它并据此判定探针成功。
process.on('uncaughtException', (error) => {
  console.log(`旧写法：未捕获错误 → ${String(error?.message ?? error).slice(0, 120)}`)
  console.log('PROBE OK：旧写法（依赖 load 引用）确实会陷入更新循环 —— scenario 7 的断言是有意义的')
  process.exit(0)
})

const source = await readFile('./src/client.jsx', 'utf8')
const guarded = `  const loadRef = useRef(load)
  loadRef.current = load
  const loadedRef = useRef(false)
  useEffect(() => {
    if (!available || loadedRef.current) return
    loadedRef.current = true
    loadRef.current()
  }, [available])`
const legacy = `  useEffect(() => {
    if (available) load()
  }, [available, load])`
if (!source.includes(guarded)) throw new Error('未找到受保护的加载 effect，探针需要更新')
await writeFile('./src/.client.legacy.jsx', source.replace(guarded, legacy))

const frames = Array.from({ length: 31 }, (_, i) => `./assets/frame-${String(i).padStart(2, '0')}.webp`)
const defines = Object.fromEntries(
  (await Promise.all(frames.map((p) => readFile(p)))).map((b, i) => [
    `__LIANG_IMG_${i}__`,
    JSON.stringify(`data:image/webp;base64,${b.toString('base64')}`),
  ]),
)
await build({
  entryPoints: ['./src/.client.legacy.jsx'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: './.client.legacy.cjs',
  external: ['react', 'react-dom', 'react-dom/client'],
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  define: defines,
  logLevel: 'silent',
})

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://127.0.0.1:5173/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Event = dom.window.Event
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { LiangCalibrator } = await import('./.client.legacy.cjs')

const EFFORTS = [{ id: 'off' }, { id: 'low' }, { id: 'high' }, { id: 'max' }]
const snapshot = {
  current: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'low' },
  routable: true,
  groups: [{ id: 'deepseek-account', models: [
    { id: 'deepseek-flash', name: 'flash', reasoning: { efforts: EFFORTS, defaultEffort: 'high' } },
    { id: 'deepseek-v4-pro', name: 'pro', reasoning: { efforts: EFFORTS, defaultEffort: 'high' } },
  ] }],
  failures: [],
  status: 'idle',
  pending: null,
  error: null,
}

let state = snapshot
const listeners = new Set()
let loads = 0
const dir = {
  store: {
    getSnapshot: () => state,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  },
  load: async () => {
    loads += 1
    state = { ...state, status: 'ready' }
    for (const fn of [...listeners]) fn()
    return state
  },
  select: async () => ({ ok: true }),
  notify() {
    state = { ...state }
    for (const fn of [...listeners]) fn()
  },
}

function Host() {
  const [, force] = React.useState(0)
  React.useEffect(() => dir.store.subscribe(() => force((n) => n + 1)), [])
  return React.createElement(LiangCalibrator, {
    locked: false,
    available: true,
    directory: dir.store,
    load: () => {
      void dir.load()
    },
    select: (s) => dir.select(s).then((r) => r.ok !== false),
  })
}

const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)
let thrown = null
try {
  await act(async () => {
    root.render(React.createElement(Host))
  })
} catch (error) {
  thrown = error
}

const before = loads
try {
  await act(async () => {
    dir.notify()
  })
} catch (error) {
  thrown = thrown ?? error
}

await rm('./src/.client.legacy.jsx', { force: true })
await rm('./.client.legacy.cjs', { force: true })

console.log(`旧写法：挂载后 loads=${before}，再通知一次后 loads=${loads}，抛错=${thrown?.message ?? '无'}`)
if (loads > 1 || thrown !== null) {
  console.log('PROBE OK：旧写法确实会重复加载/抛错 —— scenario 7 的断言是有意义的')
} else {
  console.log('PROBE WARNING：旧写法没有复现循环，scenario 7 的断言可能无法捕捉该缺陷')
  process.exitCode = 1
}

