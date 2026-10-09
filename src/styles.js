export const styles = String.raw`
/* ---- 滑动时铺满窗口的档位图：body 首个子节点 + 负 z-index，位于应用内容之下 ---- */
.ls-wallpaper {
  position: fixed;
  inset: 0;
  z-index: -1;
  opacity: 0;
  pointer-events: none;
  transition: opacity 320ms ease;
}

.ls-wallpaper-on {
  opacity: 1;
}

.ls-wallpaper-blur {
  position: absolute;
  inset: -6%;
  width: 112%;
  height: 112%;
  object-fit: cover;
  filter: blur(34px) saturate(1.15) brightness(0.55);
}

.ls-wallpaper-sharp {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 14px 44px rgba(0, 0, 0, 0.55));
}

/* 压暗层：祖先面板已被临时改成全透明，界面可读性由这一层负责。 */
.ls-wallpaper-scrim {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(120% 95% at 50% 42%,
      rgba(8, 11, 15, 0.38),
      rgba(8, 11, 15, 0.72) 68%,
      rgba(8, 11, 15, 0.86) 100%);
}

/* ---- 折叠态的三角按钮（输入框里只占一个小胶囊） ---- */
.ls-root {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
}

.ls-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: rgb(89, 188, 255);
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
}

.ls-trigger:hover {
  border-color: rgba(49, 167, 255, 0.45);
}

.ls-trigger-on {
  border-color: rgba(49, 167, 255, 0.6);
  background: rgba(21, 128, 219, 0.18);
}

.ls-tri {
  flex: none;
  font-size: 9px;
  opacity: 0.85;
}

/* ---- 悬浮面板：固定在三角按钮上方，右上角有关闭按钮 ---- */
.ls-popover {
  position: fixed;
  z-index: 70;
  box-sizing: border-box;
  max-height: min(420px, calc(100vh - 40px));
  overflow-y: auto;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: rgb(22, 26, 31);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(0, 0, 0, 0.3);
}

.ls-popover-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.ls-popover-title {
  flex: 1;
  min-width: 0;
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
  line-height: 16px;
  letter-spacing: 0.06em;
}

.ls-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 齿轮与关闭：安静的幽灵按钮。 */
.ls-gear,
.ls-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.ls-gear:hover,
.ls-close:hover {
  border-color: var(--dsw-alias-border-l2);
  color: rgb(89, 188, 255);
}

.ls-gear-on {
  border-color: rgba(49, 167, 255, 0.45);
  color: rgb(89, 188, 255);
  background: rgba(21, 128, 219, 0.14);
}

.ls-close:hover {
  color: rgb(255, 138, 128);
  border-color: rgba(255, 138, 128, 0.45);
}

/* ---- 档位设置：每个状态一行，provider / 模型 / 思考强度都能直接填 ---- */
.ls-settings {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

/* 设置粒度切换：按状态 6 / 按档位 31。 */
.ls-mode {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
}

.ls-mode-btn {
  padding: 1px 8px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-caption);
  font-size: 10px;
  line-height: 15px;
  cursor: pointer;
  white-space: nowrap;
}

.ls-mode-btn:hover {
  color: rgb(89, 188, 255);
}

.ls-mode-on {
  background: rgba(21, 128, 219, 0.22);
  color: rgb(137, 210, 255);
}

.ls-settings-clear {
  flex: none;
  padding: 1px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: transparent;
  color: rgb(89, 188, 255);
  font-size: 10px;
  line-height: 15px;
  cursor: pointer;
}

.ls-settings-clear:hover {
  background: rgba(21, 128, 219, 0.16);
}

.ls-settings-row {
  display: grid;
  grid-template-columns: 40px 84px minmax(0, 1fr) 58px;
  align-items: center;
  gap: 5px;
}

.ls-settings-row[data-unknown='true'] .ls-settings-input {
  border-color: rgba(226, 168, 78, 0.55);
}

.ls-settings-stage {
  color: var(--dsw-alias-label-caption);
  font-size: 10.5px;
  line-height: 16px;
  white-space: nowrap;
}

.ls-settings-input {
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--dsw-alias-label-primary, rgb(226, 232, 240));
  font-size: 10.5px;
  line-height: 15px;
}

.ls-settings-input::placeholder {
  color: var(--dsw-alias-label-caption);
  opacity: 0.6;
}

.ls-settings-input:focus {
  outline: none;
  border-color: rgba(49, 167, 255, 0.6);
  background: rgba(21, 128, 219, 0.10);
}

.ls-settings-hint {
  margin: 4px 0 0;
  color: var(--dsw-alias-label-caption);
  font-size: 9.5px;
  line-height: 14px;
  opacity: 0.85;
}

.ls-chip {
  display: inline-flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  min-width: 0;
  width: 100%;
  padding: 5px 10px;
  border: 1px solid rgba(49, 167, 255, 0.32);
  border-radius: 12px;
  background: rgba(21, 128, 219, 0.12);
  color: rgb(89, 188, 255);
  line-height: 18px;
  white-space: nowrap;
}

/* 展开态第一行：模型名最显眼，右侧是状态与分值。 */
.ls-chip-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.ls-model {
  overflow: hidden;
  min-width: 0;
  color: rgb(233, 241, 250);
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 0.01em;
  text-overflow: ellipsis;
}

.ls-chip-tags {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  flex: none;
}

.ls-stage {
  color: rgb(89, 188, 255);
  font-size: 11.5px;
  font-weight: 650;
  letter-spacing: 0.04em;
}

.ls-busy .ls-model {
  animation: ls-pulse 900ms ease-in-out infinite alternate;
}

@keyframes ls-pulse {
  from { opacity: 1; }
  to { opacity: 0.45; }
}

/* 折叠态胶囊里的路由文案：过长省略，完整内容在 title 里。 */
.ls-trigger-text {
  overflow: hidden;
  min-width: 0;
  max-width: 210px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ls-score {
  color: rgb(240, 196, 108);
  font-size: 11px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.06em;
  text-shadow: 0 0 8px rgba(240, 196, 108, 0.45);
}

.ls-sub {
  overflow: hidden;
  max-width: 226px;
  color: var(--dsw-alias-label-caption);
  font-size: 10px;
  line-height: 14px;
  text-overflow: ellipsis;
}

.ls-err {
  overflow: hidden;
  min-width: 0;
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 滑动变阻器（照物理课本）：端板支架 + 铜线密绕陶瓷管 + 红色接线柱 + 滑片 ---- */
.ls-rheostat {
  position: relative;
  box-sizing: border-box;
  height: 46px;
  margin: 3px 0 5px;
  user-select: none;
}

/* 原生 range 覆盖在电阻丝那一段上：透明、可点、可拖、可键盘操作。 */
.ls-range {
  position: absolute;
  left: 30px;
  right: 30px;
  top: 8px;
  bottom: 6px;
  width: calc(100% - 60px);
  height: auto;
  margin: 0;
  padding: 0;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  opacity: 0;
  cursor: pointer;
}

.ls-range:disabled {
  cursor: not-allowed;
}

.ls-range::-webkit-slider-runnable-track {
  height: 100%;
  background: transparent;
}

/* 1px 滑块让取值与指针 x 位置近似线性，自绘滑片才对得上。 */
.ls-range::-webkit-slider-thumb {
  width: 1px;
  height: 1px;
  margin-top: 0;
  appearance: none;
  -webkit-appearance: none;
  border: 0;
  background: transparent;
}

.ls-range::-moz-range-track {
  height: 100%;
  background: transparent;
}

.ls-range::-moz-range-thumb {
  width: 1px;
  height: 1px;
  border: 0;
  background: transparent;
}

/* 两端支架：立在两头的金属端板，圆角、带竖向高光。 */
.ls-plate {
  position: absolute;
  top: 2px;
  bottom: 1px;
  width: 9px;
  border-radius: 3px 3px 2px 2px;
  background: linear-gradient(90deg, rgb(96, 105, 115), rgb(203, 212, 222) 38%, rgb(139, 149, 161) 62%, rgb(80, 88, 97));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 1px 3px rgba(0, 0, 0, 0.45);
}

.ls-plate-left {
  left: 0;
}

.ls-plate-right {
  right: 0;
}

/* 端板上的横向接线柱（C / D）。 */
.ls-plate-post {
  position: absolute;
  top: 7px;
  width: 9px;
  height: 5px;
  border-radius: 2px;
  background: linear-gradient(180deg, rgb(226, 233, 240), rgb(141, 151, 163) 60%, rgb(90, 98, 108));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.ls-plate-left .ls-plate-post {
  left: -7px;
}

.ls-plate-right .ls-plate-post {
  right: -7px;
}

/* 金属导轨：滑片在上面滑行。 */
.ls-rod {
  position: absolute;
  left: 6px;
  right: 6px;
  top: 8px;
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(180deg, rgb(174, 184, 195), rgb(105, 114, 125) 60%, rgb(69, 76, 85));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

/* 浅色陶瓷管：两端露出瓷管，中间是密绕铜线。 */
.ls-tube {
  position: absolute;
  left: 12px;
  right: 12px;
  top: 22px;
  height: 15px;
  overflow: hidden;
  border-radius: 8px;
  background: linear-gradient(180deg, rgb(242, 238, 230), rgb(216, 210, 198) 45%, rgb(169, 162, 148));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.7),
    inset 0 -2px 4px rgba(0, 0, 0, 0.35),
    0 2px 4px rgba(0, 0, 0, 0.4);
}

.ls-windings {
  position: absolute;
  left: 14px;
  right: 14px;
  top: 0;
  bottom: 0;
  background-image:
    repeating-linear-gradient(88deg,
      rgba(255, 226, 170, 0.42) 0 1px,
      rgba(112, 66, 18, 0.62) 1px 2.2px,
      rgba(0, 0, 0, 0.30) 2.2px 2.9px,
      rgba(0, 0, 0, 0) 2.9px 3.8px),
    linear-gradient(180deg, rgb(203, 156, 94), rgb(148, 99, 38) 55%, rgb(99, 62, 17));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

/* 接入电路的那一段（左端到滑片）稍亮，让滑片位置一眼可读。 */
.ls-coil-live {
  position: absolute;
  left: 14px;
  top: 0;
  bottom: 0;
  background: linear-gradient(180deg, rgba(255, 236, 190, 0.38), rgba(255, 214, 140, 0.14));
  box-shadow: inset 0 0 6px rgba(255, 214, 140, 0.5);
}

/* 瓷管两端的红色接线柱（A / B）。 */
.ls-post {
  position: absolute;
  top: 16px;
  width: 7px;
  height: 11px;
  border-radius: 2px 2px 1px 1px;
  background: linear-gradient(180deg, rgb(255, 146, 138), rgb(192, 57, 43) 45%, rgb(125, 32, 24));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.45);
}

.ls-post-left {
  left: 16px;
}

.ls-post-right {
  right: 16px;
}

/* 底部横梁：把两块端板连起来。 */
.ls-base {
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 1px;
  height: 3px;
  border-radius: 2px;
  background: linear-gradient(180deg, rgb(141, 151, 163), rgb(82, 90, 100));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}

/* 滑片轨道：与铜线绕组等宽（再各缩 3px，两端不会压住红色接线柱）。 */
.ls-wiper-track {
  position: absolute;
  left: 30px;
  right: 30px;
  top: 0;
  bottom: 0;
}

/* 滑片：宽压板（骑在导轨上）+ 轻楔子 + 触点。 */
.ls-wiper {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 22px;
  margin-left: -11px;
}

.ls-wiper-plate {
  position: absolute;
  left: 0;
  right: 0;
  top: 4px;
  height: 5px;
  border: 1px solid rgba(30, 35, 40, 0.55);
  border-radius: 2px;
  background: linear-gradient(180deg, rgb(244, 248, 252), rgb(166, 176, 188) 55%, rgb(104, 113, 123));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.85);
}

.ls-wiper-wedge {
  position: absolute;
  left: 6px;
  right: 6px;
  top: 9px;
  bottom: 11px;
  background: linear-gradient(100deg, rgb(242, 246, 251) 0%, rgb(200, 210, 220) 32%, rgb(147, 160, 173) 100%);
  clip-path: polygon(0 0, 100% 0, 62% 100%, 38% 100%);
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45));
}

.ls-wiper-tip {
  position: absolute;
  left: 50%;
  bottom: 9px;
  width: 5px;
  height: 4px;
  margin-left: -2.5px;
  border-radius: 1px;
  background: rgb(238, 244, 251);
  box-shadow: 0 0 6px rgba(120, 190, 255, 0.55);
}

.ls-rheostat[data-blocked='true'] {
  opacity: 0.45;
}

.ls-root:has(.ls-range:disabled) {
  border-color: var(--dsw-alias-state-warning-primary, rgba(226, 168, 78, 0.5));
}

.ls-rheostat:has(.ls-range:focus-visible) {
  outline: 2px solid var(--dsw-focus-ring-color, rgb(78, 168, 255));
  outline-offset: 2px;
  border-radius: 8px;
}

.ls-blocked {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-state-warning-primary, rgb(226, 168, 78));
  font-size: 10px;
  line-height: 14px;
  white-space: nowrap;
}

.ls-retry {
  padding: 0 6px;
  border: 1px solid currentColor;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 10px;
  line-height: 15px;
  cursor: pointer;
}

.ls-retry:hover {
  background: rgba(226, 168, 78, 0.16);
}

/* 六个状态标签：与原项目一致，沿轨道均匀分布并以标签中心对齐刻度点。 */
.ls-stations {
  display: flex;
  justify-content: space-between;
  box-sizing: border-box;
  height: 13px;
  padding: 0 16px;
}

.ls-station {
  width: 0;
  color: var(--dsw-alias-label-caption);
  font-size: 9.5px;
  line-height: 12px;
  text-align: center;
  white-space: nowrap;
  transform: translateX(-50%);
}

.ls-station-active {
  color: rgb(78, 187, 255);
  font-weight: 650;
  text-shadow: 0 0 8px rgba(43, 167, 255, 0.7);
}

.ls-station[data-available='false'] {
  opacity: 0.4;
}

.ls-ticks {
  display: flex;
  justify-content: space-between;
  padding: 0 8px;
  color: var(--dsw-alias-label-caption);
  font-size: 9px;
  line-height: 10px;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

@media (prefers-reduced-motion: reduce) {
  .ls-banner,
  .ls-banner-visible {
    transition: none;
  }
  .ls-banner-in,
  .ls-banner-out {
    animation: none;
    transition: none;
  }
  .ls-busy .ls-model {
    animation: none;
  }
}
`


