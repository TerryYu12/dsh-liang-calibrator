// 预览用入口：导出真实样式与和组件同构的标记，供 preview.mjs 渲染截图。
import { styles } from '../src/styles.js'
import { MAX_SCORE, MIN_SCORE, SCORE_COUNT, STAGES, frameIndexFor, stageIndexFor } from '../src/levels.js'

const GEAR = `<button type="button" class="ls-gear${''}" title="档位设置">
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <circle cx="8" cy="8" r="5.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="2.5 1.7"></circle>
    <circle cx="8" cy="8" r="1.8" fill="currentColor"></circle>
  </svg></button>`

function rheostat(score) {
  const wiperPercent = ((score - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * 100
  const activeStage = stageIndexFor(frameIndexFor(score))
  const stations = STAGES.map(
    (stage, index) => `<span class="ls-station${index === activeStage ? ' ls-station-active' : ''}" data-available="true">${stage}</span>`,
  ).join('')
  return `<div class="ls-body">
    <span class="ls-chip">
      <span class="ls-chip-main">
        <span class="ls-model">DeepSeek-V41-Flash</span>
        <span class="ls-chip-tags"><span class="ls-stage">梁圣</span><span class="ls-score">+07</span></span>
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
    <div class="ls-stations">${stations}</div>
    <div class="ls-ticks"><span>${MIN_SCORE}</span><span>0</span><span>+${MAX_SCORE}</span></div>
  </div>`
}

function settings(stageMode) {
  const rows = stageMode
    ? STAGES.map((stage, index) => `<div class="ls-settings-row" data-unknown="${index === 2 ? 'true' : 'false'}" title="${stage}">
        <span class="ls-settings-stage">${stage}</span>
        <input class="ls-settings-input" value="${index === 0 ? '' : 'cmd'}" placeholder="deepseek-account">
        <input class="ls-settings-input" value="${index === 0 ? '' : index === 1 ? 'deepseek-v4-pro' : 'deepseek/deepseek-v4.1-flash'}" placeholder="deepseek-flash">
        <input class="ls-settings-input" value="${index === 0 ? '' : 'max'}" placeholder="off">
      </div>`).join('')
    : Array.from({ length: SCORE_COUNT }, (_, frame) => {
        const score = frame + MIN_SCORE
        const label = (score > 0 ? '+' : score < 0 ? '-' : '') + String(Math.abs(score)).padStart(2, '0')
        const filled = frame === 30
        return `<div class="ls-settings-row" title="${label} · ${STAGES[stageIndexFor(frame)]}">
          <span class="ls-settings-stage">${score === 0 ? '00' : label}</span>
          <input class="ls-settings-input" value="${filled ? 'cmd' : ''}" placeholder="deepseek-account">
          <input class="ls-settings-input" value="${filled ? 'deepseek/deepseek-v4.1-flash' : ''}" placeholder="${frame < 12 ? 'deepseek-flash' : frame < 24 ? 'deepseek/deepseek-v4.1-flash' : 'deepseek-v4-pro'}">
          <input class="ls-settings-input" value="${filled ? 'max' : ''}" placeholder="${['off', 'low', 'high', 'max'][Math.floor((frame % 6) / 1.5) % 4]}">
        </div>`
      }).join('')

  return `<div class="ls-settings">${rows}
    <p class="ls-settings-hint">${stageMode
      ? '六个状态各一条：填了 provider 与模型后，该状态内的每一档都用这条路由。'
      : '31 档逐档设置，优先于「按状态」的设置；灰色占位符是自动分档会选的模型。'}</p>
  </div>`
}

export const markup = ({ score = 0, expanded = false, view = 'slider', stageMode = true, blocked, inline = false }) =>
  `<div class="ls-root"${inline ? ' style="display: inline-flex"' : ''}>
  <button type="button" class="ls-trigger${expanded ? ' ls-trigger-on' : ''}">
    <span class="ls-tri">${expanded ? '▾' : '▸'}</span>
    <span class="ls-trigger-text">cmd · deepseek/deepseek-v4.1-flash · max</span>
  </button>
  ${blocked === undefined ? '' : `<span class="ls-blocked">${blocked}<button type="button" class="ls-retry">重试</button></span>`}
  ${expanded ? `<div class="ls-popover" style="position: absolute; right: 0; top: calc(100% + 8px); width: 420px; max-height: none">
    <div class="ls-popover-head">
      ${view === 'settings'
        ? `<span class="ls-mode"><button type="button" class="ls-mode-btn${stageMode ? ' ls-mode-on' : ''}">按状态 6</button><button type="button" class="ls-mode-btn${stageMode ? '' : ' ls-mode-on'}">按档位 31</button></span>`
        : '<span class="ls-popover-title">滑动变祖器</span>'}
      ${view === 'settings' ? '<button type="button" class="ls-settings-clear">全部自动</button>' : ''}
      ${GEAR}
      <button type="button" class="ls-close">✕</button>
    </div>
    ${view === 'settings' ? settings(stageMode) : rheostat(score)}
  </div>` : ''}
</div>`

export { styles }



