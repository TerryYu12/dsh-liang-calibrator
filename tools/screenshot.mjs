// 用 headless Chrome 渲染真实 CSS，生成 README 用的界面截图到 docs/。
//
//   node tools/screenshot.mjs
//
// 依赖 assets/frame-*.webp（背景示意图会用到其中一帧）。
import { build } from 'esbuild'
import { writeFile, rm, mkdir, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const CHROME = process.env.CHROME_PATH
  ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

await mkdir('./.preview', { recursive: true })
await mkdir('./docs', { recursive: true })

await build({
  entryPoints: ['./tools/preview-entry.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: './.preview/bundle.mjs',
  external: ['react', 'react-dom', 'react-dom/client'],
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  define: Object.fromEntries(
    Array.from({ length: 31 }, (_, i) => [`__LIANG_IMG_${i}__`, JSON.stringify(`frame-${i}`)]),
  ),
  logLevel: 'warning',
})

const { styles, markup } = await import('../.preview/bundle.mjs')

// 把主题变量换成固定色，让截图在没有 DSH 的环境里也是最终观感。
const themed = styles
  .replaceAll('var(--dsw-alias-border-l2)', '#2b3038')
  .replaceAll('var(--dsw-alias-interactive-bg-hover)', 'rgba(255,255,255,.05)')
  .replaceAll('var(--dsw-alias-label-caption)', '#8b94a1')
  .replaceAll('var(--dsw-alias-label-primary, rgb(226, 232, 240))', '#e2e8f0')
  .replaceAll('var(--dsw-alias-state-error-primary)', '#ff6b6b')
  .replaceAll('var(--dsw-alias-state-warning-primary, rgb(226, 168, 78))', '#e2a84e')
  .replaceAll('var(--dsw-alias-state-warning-primary, rgba(226, 168, 78, 0.5))', '#e2a84e')
  .replaceAll('var(--dsw-focus-ring-color, rgb(78, 168, 255))', '#4ea8ff')

const page = (body, { width = 520, background = '#16181c', extra = '' } = {}) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 22px; width: ${width}px; box-sizing: content-box;
    background: ${background};
    font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  }
  .label { color: #7d8794; font-size: 11px; margin: 0 0 8px; letter-spacing: .08em; }
  .block { margin-bottom: 18px; }
  ${themed}
  ${extra}
</style></head><body>${body}</body></html>`

const PYTHON = process.env.PYTHON_PATH
  ?? 'C:\\Users\\11\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe'

const shot = async (name, html, { width }) => {
  const file = `./.preview/${name}.html`
  await writeFile(file, html)
  // Chrome 的 --screenshot 相对路径不按进程 cwd 解析，这里一律给绝对路径。
  const out = `${process.cwd()}\\docs\\${name}.png`
  await rm(out, { force: true })
  // 窗口给足高度，渲染完整页面；随后按内容裁掉多余背景（避免配图被截断）。
  await new Promise((resolve, reject) => {
    const child = spawn(CHROME, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      `--window-size=${width},2600`,
      `--screenshot=${out}`,
      'file:///' + process.cwd().replaceAll('\\', '/') + `/.preview/${name}.html`,
    ], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('close', resolve)
  })
  await new Promise((resolve) => {
    const child = spawn(PYTHON, ['tools/trim-png.py', out, '22'], { stdio: 'inherit' })
    child.once('error', (error) => {
      console.warn('裁边失败（保留原图）：', error.message)
      resolve()
    })
    child.once('close', resolve)
  })
  console.log('wrote', out)
}

// 背景示意图：模拟 DSH 窗口"滑动中"的样子 —— 档位图盖在原壁纸之上，面板临时透明。
let frameImage = ''
try {
  frameImage = (await readFile('./assets/frame-24.webp')).toString('base64')
} catch {
  console.warn('缺少 assets/frame-24.webp，背景示意图将使用占位色块（先跑 scripts/fetch-frames.mjs）')
}
// 「背图 31」设置页的缩略图示例：直接用第 24 帧。
const thumbSrc = frameImage === '' ? '' : `data:image/webp;base64,${frameImage}`

const wallpaperLayers = frameImage === ''
  ? '<div class="ls-wallpaper ls-wallpaper-on" style="position:absolute;inset:0;z-index:0;background:linear-gradient(135deg,#3a6ea5,#b7791f)"></div>'
  : `<div class="ls-wallpaper ls-wallpaper-on" style="position: absolute; inset: 0; z-index: 0;">
       <img class="ls-wallpaper-blur" src="data:image/webp;base64,${frameImage}">
       <img class="ls-wallpaper-sharp" src="data:image/webp;base64,${frameImage}">
       <div class="ls-wallpaper-scrim"></div>
     </div>`

const backgroundMock = `
<!-- 原壁纸画在"画布"上（这里用页面背景模拟），负 z-index 的插件图层才会盖在它之上、界面之下。
     这和真实场景一致：原背景在 html 画布层，插件的 body 首子节点在它上面、应用内容下面。 -->
<div style="position: relative; width: 720px; height: 420px; overflow: hidden; border-radius: 14px; border: 1px solid #2b3038; background: radial-gradient(70% 60% at 25% 20%, rgba(56,120,178,.45), transparent 70%), radial-gradient(50% 50% at 80% 80%, rgba(183,121,31,.35), transparent 70%), linear-gradient(160deg, #16202b, #0e141b);">
  <!-- ① 插件背景图层：盖在原壁纸之上、界面之下 -->
  ${wallpaperLayers}
  <!-- ② 界面（效果期间面板被临时置为透明） -->
  <div style="position: absolute; inset: 0; display: flex;">
    <div style="width: 132px; padding: 14px 12px; border-right: 1px solid rgba(255,255,255,.06);">
      <div style="color: #7d8794; font-size: 11px; margin-bottom: 10px;">会话</div>
      <div style="height: 22px; border-radius: 6px; background: rgba(255,255,255,.08); margin-bottom: 6px;"></div>
      <div style="height: 22px; border-radius: 6px; background: rgba(255,255,255,.05); margin-bottom: 6px;"></div>
      <div style="height: 22px; border-radius: 6px; background: rgba(255,255,255,.05);"></div>
    </div>
    <div style="flex: 1; display: flex; flex-direction: column; justify-content: flex-end; padding: 14px;">
      <div style="align-self: flex-end; max-width: 70%; padding: 8px 12px; border-radius: 12px; background: rgba(38,52,68,.94); color: #dfe7f1; font-size: 12.5px; line-height: 19px; margin-bottom: 8px;">
        把滑杆做成滑动变阻器的样子，滑的时候就是滑那个划片
      </div>
      <div style="max-width: 74%; padding: 8px 12px; border-radius: 12px; background: rgba(24,30,38,.94); color: #c7d2df; font-size: 12.5px; line-height: 19px; margin-bottom: 12px;">
        已按课本改成铜线密绕瓷管 + 端板接线柱，滑片是压板加楔子。
      </div>
      <!-- 输入框那一行：折叠胶囊 + 右侧的发送按钮示意 -->
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
        ${markup({ expanded: false, route: 'deepseek-account · DeepSeek-V41-Flash · low' })}
        <div style="width: 74px; height: 28px; border-radius: 999px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.08);"></div>
      </div>
    </div>
  </div>
</div>
<p class="label" style="margin-top: 10px;">滑动时：档位图盖在<b>原壁纸之上</b>、界面之下，面板临时透明；停手 5 秒后淡出并原样还原</p>
`

const shots = [
  ['01-collapsed', page(`
    <p class="label">输入框里的折叠态</p>
    <div class="block">${markup({ expanded: false })}</div>
    <div class="block">${markup({ expanded: false, blocked: '模型目录未就绪', route: 'cmd · deepseek/deepseek-v4.1-flash · max' })}</div>
  `, { width: 430 }), { width: 430 }],

  ['02-panel', page(`
    <p class="label">点三角展开：滑动变阻器</p>
    ${markup({ expanded: true, score: -8, inline: true })}
  `, { width: 470 }), { width: 470 }],

  ['03-settings-stage', page(`
    <p class="label">设置 · 按状态（6 条）</p>
    ${markup({ expanded: true, view: 'settings', mode: 'stage', inline: true })}
  `, { width: 470 }), { width: 470 }],

  ['04-settings-frame', page(`
    <p class="label">设置 · 按档位（31 条，可逐档覆盖）</p>
    ${markup({ expanded: true, view: 'settings', mode: 'frame', inline: true })}
  `, { width: 470 }), { width: 470 }],

  ['06-settings-names', page(`
    <p class="label">设置 · 名字（31 档可改名；相邻同名合并成一段）</p>
    ${markup({ expanded: true, view: 'settings', mode: 'name', inline: true })}
  `, { width: 470 }), { width: 470 }],

  ['07-settings-images', page(`
    <p class="label">设置 · 背图（31 档各挑一张，滑动时铺满窗口）</p>
    ${markup({ expanded: true, view: 'settings', mode: 'image', thumb: thumbSrc, inline: true })}
  `, { width: 470 }), { width: 470 }],

  ['05-background', page(backgroundMock, { width: 700, background: '#0d1117' }), { width: 700 }],
]

for (const [name, html, size] of shots) await shot(name, html, size)
console.log('done')



