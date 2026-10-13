// 预览用入口：导出真实样式与和组件同构的标记，供 screenshot.mjs 渲染截图。
// 必须与 src/client.jsx 保持同构：四个设置页（状态 6 / 档位 31 / 名字 31 / 背图 31）、
// 站名行按名字分段定位、背图行的缩略图 / 选择图片 / 清除。
import { styles } from '../src/styles.js'
import {
  MAX_SCORE,
  MIN_SCORE,
  SCORE_COUNT,
  STAGES,
  formatSignedScore,
  frameIndexFor,
  scoreOfFrame,
  stageIndexFor,
} from '../src/levels.js'
import { displayNameAt, nameRuns, visibleRuns } from '../src/labels.js'

const MODES = [
  ['stage', '按状态 6'],
  ['frame', '按档位 31'],
  ['name', '名字 31'],
  ['image', '背图 31'],
]

const CLEAR_LABEL = { stage: '全部自动', frame: '全部自动', name: '全部默认', image: '全部内置' }

const HINT = {
  stage: '六个状态各一条：填了 provider 与模型后，该状态内的每一档都用这条路由。 三项都能直接填（provider / 模型 id / 思考强度 off、high、max…），留空即沿用上一层。',
  frame: '31 档逐档设置，优先于「按状态」的设置；灰色占位符是自动分档会选的模型。 三项都能直接填（provider / 模型 id / 思考强度 off、high、max…），留空即沿用上一层。',
  name: '给 31 档各起一个名字：留空用默认梁名；相邻档位写成同一个名字就合并成一段，滑杆下方的站名行会跟着变。',
  image: '给 31 档各挑一张自定义背图：滑动到该档时铺在窗口上，留空用内置档位图；图片只存本机（IndexedDB），同一张图给多个档位只存一份。',
}

const signed = (frame) => formatSignedScore(scoreOfFrame(frame))

function routeRow({ label, title, provider, model, effort, providerHint, modelHint, effortHint, unknown = false }) {
  return `<div class="ls-settings-row" data-unknown="${unknown ? 'true' : 'false'}" title="${title}">
      <span class="ls-settings-stage">${label}</span>
      <input class="ls-settings-input" value="${provider}" placeholder="${providerHint}">
      <input class="ls-settings-input" value="${model}" placeholder="${modelHint}">
      <input class="ls-settings-input" value="${effort}" placeholder="${effortHint}">
    </div>`
}

function nameRow(frame, value) {
  const label = signed(frame)
  const fallback = STAGES[stageIndexFor(frame)]
  return `<div class="ls-settings-row ls-settings-row-name" title="${label} · ${fallback}">
      <span class="ls-settings-stage">${label}</span>
      <input class="ls-settings-input" value="${value}" placeholder="${fallback}">
    </div>`
}

function imageRow(frame, thumb) {
  const label = signed(frame)
  const title = `${label} · ${displayNameAt([], frame)}`
  const filled = thumb !== ''
  const cell = filled
    ? `<img class="ls-settings-thumb" src="${thumb}" alt="">`
    : '<span class="ls-settings-empty">内置</span>'
  return `<div class="ls-settings-row ls-settings-row-image" data-filled="${filled ? 'true' : 'false'}" title="${title}">
      <span class="ls-settings-stage">${label}</span>
      ${cell}
      <label class="ls-settings-btn">选择图片<input type="file" accept="image/*" class="ls-settings-file"></label>
      <button type="button" class="ls-settings-btn ls-settings-btn-clear"${filled ? '' : ' disabled'}>清除</button>
    </div>`
}

const GEAR = `<button type="button" class="ls-gear${''}" title="档位设置">
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <circle cx="8" cy="8" r="5.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="2.5 1.7"></circle>
    <circle cx="8" cy="8" r="1.8" fill="currentColor"></circle>
  </svg></button>`

function settings(mode, thumb) {
  let rows = ''
  if (mode === 'stage') {
    rows = STAGES.map((stage, index) => routeRow({
      label: stage,
      title: stage,
      provider: index === 0 ? '' : 'cmd',
      model: index === 0 ? '' : index === 1 ? 'deepseek-v4-pro' : 'deepseek/deepseek-v4.1-flash',
      effort: index === 0 ? '' : 'max',
      providerHint: 'deepseek-account',
      modelHint: 'deepseek-flash',
      effortHint: 'off',
      unknown: index === 2,
    })).join('')
  } else if (mode === 'frame') {
    rows = Array.from({ length: SCORE_COUNT }, (_, frame) => {
      const filled = frame === 30
      return routeRow({
        label: signed(frame),
        title: `${signed(frame)} · ${STAGES[stageIndexFor(frame)]}`,
        provider: filled ? 'cmd' : '',
        model: filled ? 'deepseek/deepseek-v4.1-flash' : '',
        effort: filled ? 'max' : '',
        providerHint: 'deepseek-account',
        modelHint: frame < 12 ? 'deepseek-flash' : frame < 24 ? 'deepseek/deepseek-v4.1-flash' : 'deepseek-v4-pro',
        effortHint: ['off', 'low', 'high', 'max'][Math.floor((frame % 6) / 1.5) % 4],
      })
    }).join('')
  } else if (mode === 'name') {
    rows = Array.from({ length: SCORE_COUNT }, (_, frame) => nameRow(frame, frame >= 29 ? '梁帝' : '')).join('')
  } else {
    rows = Array.from({ length: SCORE_COUNT }, (_, frame) => imageRow(frame, frame === 24 || frame === 30 ? thumb : '')).join('')
  }
  return `<div class="ls-settings">${rows}
    <p class="ls-settings-hint">${HINT[mode]}</p>
  </div>`
}

function stations(score) {
  return visibleRuns(nameRuns([]), frameIndexFor(score)).map((run) => {
    const left = `calc(30px + (100% - 60px) * ${run.center.toFixed(4)})`
    return `<span class="ls-station${run.active ? ' ls-station-active' : ''}" data-available="true" style="left: ${left}">${run.name}</span>`
  }).join('')
}

function rheostat(score) {
  const wiperPercent = ((score - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * 100
  const stageName = displayNameAt([], frameIndexFor(score))
  return `<div class="ls-body">
    <span class="ls-chip">
      <span class="ls-chip-main">
        <span class="ls-model">DeepSeek-V41-Flash</span>
        <span class="ls-chip-tags"><span class="ls-stage">${stageName}</span><span class="ls-score">${formatSignedScore(score)}</span></span>
      </span>
      <span class="ls-sub">deepseek-account · low</span>
    </span>
    <div class="ls-rheostat" data-blocked="false">
      <span class="ls-plate ls-plate-left"><span class="ls-plate-post"></span></span>
      <span class="ls-plate ls-plate-right"><span class="ls-plate-post"></span></span>
      <span class="ls-base"></span>
      <span class="ls-rod"></span>
      <span class="ls-tube"><span class="ls-windings"></span><span class="ls-coil-live" style="width: ${wiperPercent}%"></span></span>
      <span class="ls-post ls-post-left"></span>
      <span class="ls-post ls-post-right"></span>
      <span class="ls-wiper-track"><span class="ls-wiper" style="left: ${wiperPercent}%">
        <span class="ls-wiper-plate"></span><span class="ls-wiper-wedge"></span><span class="ls-wiper-tip"></span>
      </span></span>
      <input class="ls-range" type="range" min="${MIN_SCORE}" max="${MAX_SCORE}" value="${score}">
    </div>
    <div class="ls-stations">${stations(score)}</div>
    <div class="ls-ticks"><span>${MIN_SCORE}</span><span>0</span><span>+${MAX_SCORE}</span></div>
  </div>`
}

export const markup = ({ score = 0, expanded = false, view = 'slider', mode = 'stage', thumb = '', blocked, inline = false, route = 'deepseek-account · DeepSeek-V41-Flash · low' }) =>
  `<div class="ls-root"${inline ? ' style="display: block"' : ''}>
  <button type="button" class="ls-trigger${expanded ? ' ls-trigger-on' : ''}">
    <span class="ls-tri">${expanded ? '▾' : '▸'}</span>
    <span class="ls-trigger-text">${route}</span>
  </button>
  ${blocked === undefined ? '' : `<span class="ls-blocked">${blocked}<button type="button" class="ls-retry">重试</button></span>`}
  ${expanded ? `<div class="ls-popover" style="position: static; width: 420px; max-height: none; margin-top: 8px">
    <div class="ls-popover-head">
      ${view === 'settings'
        ? `<span class="ls-mode">${MODES.map(([key, label]) => `<button type="button" class="ls-mode-btn${mode === key ? ' ls-mode-on' : ''}">${label}</button>`).join('')}</span>`
        : '<span class="ls-popover-title">滑动变祖器</span>'}
      ${view === 'settings' ? `<button type="button" class="ls-settings-clear">${CLEAR_LABEL[mode]}</button>` : ''}
      ${GEAR}
      <button type="button" class="ls-close">✕</button>
    </div>
    ${view === 'settings' ? settings(mode, thumb) : rheostat(score)}
  </div>` : ''}
</div>`

export { styles }



