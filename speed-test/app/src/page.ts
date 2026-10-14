// The page, laid out like speed.cloudflare.com: same grid, sizes and spacing
// (their Tailwind classes are noted where the numbers come from), with Datum's
// logo, type and palette. dist/client.js fills it in and runs the test.
import { FONTS, LOGO, THEME_CSS, THEME_SCRIPT } from "./theme.js";

// Phosphor icons (MIT), the set speed.cloudflare.com uses, on a 256 grid.
const icon = (d: string, cls = "", size = 18): string =>
  `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;

const I = {
  info: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm16-40a8,8,0,0,1-8,8,16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40A8,8,0,0,1,144,176ZM112,84a12,12,0,1,1,12,12A12,12,0,0,1,112,84Z",
  sun: "M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm72,88a64,64,0,1,1-64-64A64.07,64.07,0,0,1,192,128Zm-16,0a48,48,0,1,0-48,48A48.05,48.05,0,0,0,176,128ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z",
  moon: "M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.910,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.52-20.88,104.840,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,65.66,67.11a89,89,0,0,1,31.4-26A106,106,0,0,0,96,56,104.11,104.11,0,0,0,200,160a106,106,0,0,0,14.92-1.06A89,89,0,0,1,188.9,190.34Z",
  desktop: "M208,40H48A24,24,0,0,0,24,64V176a24,24,0,0,0,24,24h72v16H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16H136V200h72a24,24,0,0,0,24-24V64A24,24,0,0,0,208,40Zm8,136a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V64a8,8,0,0,1,8-8H208a8,8,0,0,1,8,8Z",
  arrowDown: "M208.49,152.49l-72,72a12,12,0,0,1-17,0l-72-72a12,12,0,0,1,17-17L116,187V40a12,12,0,0,1,24,0V187l51.51-51.52a12,12,0,0,1,17,17Z",
  arrowUp: "M208.49,120.49a12,12,0,0,1-17,0L140,69V216a12,12,0,0,1-24,0V69L64.49,120.49a12,12,0,0,1-17-17l72-72a12,12,0,0,1,17,0l72,72A12,12,0,0,1,208.49,120.49Z",
  play: "M232.4,114.49,88.32,26.35a16,16,0,0,0-16.2-.3A15.86,15.86,0,0,0,64,39.87V216.13A15.94,15.94,0,0,0,80,232a16.07,16.07,0,0,0,8.36-2.35L232.4,141.51a15.81,15.81,0,0,0,0-27ZM80,215.94V40l143.83,88Z",
  pause: "M200,32H160a16,16,0,0,0-16,16V208a16,16,0,0,0,16,16h40a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm0,176H160V48h40ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Zm0,176H56V48H96Z",
  retest: "M224,48V96a8,8,0,0,1-8,8H168a8,8,0,0,1,0-16h28.69L182.06,73.37a79.56,79.56,0,0,0-56.13-23.43h-.45A79.52,79.52,0,0,0,69.59,72.71,8,8,0,0,1,58.41,61.27a96,96,0,0,1,135,.79L208,76.690V48a8,8,0,0,1,16,0ZM186.41,183.29a80,80,0,0,1-112.47-.66L59.31,168H88a8,8,0,0,0,0-16H40a8,8,0,0,0-8,8v48a8,8,0,0,0,16,0V179.31l14.630,14.63A95.43,95.43,0,0,0,130,222.06h.53a95.36,95.36,0,0,0,67.07-27.33,8,8,0,0,0-11.18-11.44Z",
  start: "M230.32,117.9,86.24,29.79a11.91,11.91,0,0,0-12.17-.23A11.71,11.71,0,0,0,68,39.89V216.11a11.71,11.71,0,0,0,6.07,10.33,11.91,11.91,0,0,0,12.17-.23L230.32,138.1a11.82,11.82,0,0,0,0-20.2Zm-4.18,13.37L82.06,219.39a4,4,0,0,1-4.07.07,3.77,3.77,0,0,1-2-3.35V39.89a3.77,3.77,0,0,1,2-3.35,4,4,0,0,1,4.07.07l144.08,88.12a3.8,3.8,0,0,1,0,6.54Z",
  streaming: "M162.22,116.67l-48-32A4,4,0,0,0,108,88v64a4,4,0,0,0,2.11,3.53,4,4,0,0,0,4.11-.2l48-32a4,4,0,0,0,0-6.66ZM116,144.53V95.47L152.79,120ZM208,44H48A20,20,0,0,0,28,64V176a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V64A20,20,0,0,0,208,44Zm12,132a12,12,0,0,1-12,12H48a12,12,0,0,1-12-12V64A12,12,0,0,1,48,52H208a12,12,0,0,1,12,12Zm-56,48a4,4,0,0,1-4,4H96a4,4,0,0,1,0-8h64A4,4,0,0,1,164,224Z",
  gaming: "M176,108H152a4,4,0,0,1,0-8h24a4,4,0,0,1,0,8Zm-72-8H92V88a4,4,0,0,0-8,0v12H72a4,4,0,0,0,0,8H84v12a4,4,0,0,0,8,0V108h12a4,4,0,0,0,0-8Zm134.21,98.36a32,32,0,0,1-48.84,4.27l-.17-.18L148.29,156H107.72L66.81,202.44l-.18.19A32.08,32.08,0,0,1,44,212a32,32,0,0,1-31.5-37.56L28.87,90.21A55.87,55.87,0,0,1,83.89,44H172a56.07,56.07,0,0,1,55.1,46.1.29.29,0,0,1,0,.1l16.37,84.16A31.86,31.86,0,0,1,238.21,198.36ZM172,148a48,48,0,1,0,0-96H83.9A47.9,47.9,0,0,0,36.74,91.67L20.36,175.9a24,24,0,0,0,19.48,27.73,24,24,0,0,0,21-6.58l42-47.690a4,4,0,0,1,3-1.36Zm63.63,27.83-11-56.66A56.09,56.09,0,0,1,172,156H159l36.16,41.06a24,24,0,0,0,40.52-21.23Z",
  video: "M249.89,76.47a4,4,0,0,0-4.11.2L204,104.53V72a12,12,0,0,0-12-12H32A12,12,0,0,0,20,72V184a12,12,0,0,0,12,12H192a12,12,0,0,0,12-12V151.47l41.78,27.86A4,4,0,0,0,252,176V80A4,4,0,0,0,249.890,76.47ZM196,184a4,4,0,0,1-4,4H32a4,4,0,0,1-4-4V72a4,4,0,0,1,4-4H192a4,4,0,0,1,4,4Zm48-15.47-40-26.67V114.14l40-26.67Z",
  star: "M239.18,97.26A16.38,16.38,0,0,0,224.92,86l-59-4.76L143.14,26.15a16.36,16.36,0,0,0-30.27,0L90.11,81.23,31.08,86a16.46,16.46,0,0,0-9.37,28.86l45,38.83L53,211.75a16.38,16.38,0,0,0,24.5,17.82L128,198.49l50.53,31.08A16.4,16.4,0,0,0,203,211.75l-13.76-58.07,45-38.83A16.43,16.43,0,0,0,239.18,97.26Zm-15.34,5.47-48.7,42a8,8,0,0,0-2.56,7.91l14.88,62.8a.37.37,0,0,1-.17.48c-.18.14-.23.11-.38,0l-54.72-33.65a8,8,0,0,0-8.38,0L69.09,215.94c-.15.09-.19.12-.38,0a.37.37,0,0,1-.17-.48l14.88-62.8a8,8,0,0,0-2.56-7.91l-48.7-42c-.12-.1-.23-.19-.13-.5s.18-.27.33-.29l63.92-5.16A8,8,0,0,0,103,91.86l24.62-59.61c.08-.17.11-.25.35-.25s.27.08.35.25L153,91.86a8,8,0,0,0,6.75,4.92l63.920,5.16c.15,0,.24,0,.33.29S224,102.63,223.84,102.73Z",
  starFill: "M234.29,114.85l-45,38.83L203,211.75a16.4,16.4,0,0,1-24.5,17.82L128,198.49,77.47,229.57A16.4,16.4,0,0,1,53,211.75l13.76-58.07-45-38.83A16.46,16.46,0,0,1,31.08,86l59-4.76,22.76-55.08a16.36,16.36,0,0,1,30.27,0l22.75,55.08,59,4.76a16.46,16.46,0,0,1,9.37,28.86Z",
  close: "M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z",
  plus: "M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z",
  minus: "M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128Z",
  network: "M160,40a32,32,0,1,0-40,31v17H72a24,24,0,0,0-24,24v16.6a32,32,0,1,0,16,0V112a8,8,0,0,1,8-8h48v24.6a32,32,0,1,0,16,0V104h48a8,8,0,0,1,8,8v16.6a32,32,0,1,0,16,0V112a24,24,0,0,0-24-24H136V71A32.06,32.06,0,0,0,160,40ZM112,40a16,16,0,1,1,16,16A16,16,0,0,1,112,40ZM72,160a16,16,0,1,1-16-16A16,16,0,0,1,72,160Zm72,0a16,16,0,1,1-16-16A16,16,0,0,1,144,160Zm72,0a16,16,0,1,1-16-16A16,16,0,0,1,216,160Z",
  pin: "M128,64a40,40,0,1,0,40,40A40,40,0,0,0,128,64Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,128Zm0-112a88.1,88.1,0,0,0-88,88c0,31.4,14.51,64.68,42,96.25a254.19,254.19,0,0,0,41.45,38.3,8,8,0,0,0,9.18,0A254.19,254.19,0,0,0,174,200.25c27.45-31.57,42-64.85,42-96.25A88.1,88.1,0,0,0,128,16Zm0,206c-16.53-13-72-60.75-72-118a72,72,0,0,1,144,0C200,161.23,144.53,209,128,222Z",
  server: "M208,136H48a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V152A16,16,0,0,0,208,136Zm0,64H48V152H208v48Zm0-160H48A16,16,0,0,0,32,56v48a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V56A16,16,0,0,0,208,40Zm0,64H48V56H208v48ZM192,80a12,12,0,1,1-12-12A12,12,0,0,1,192,80Zm0,96a12,12,0,1,1-12-12A12,12,0,0,1,192,176Z",
  share: "M176,160a39.89,39.89,0,0,0-28.62,12.09l-46.1-29.63a39.8,39.8,0,0,0,0-28.92l46.1-29.63a40,40,0,1,0-8.66-13.45l-46.1,29.63a40,40,0,1,0,0,55.82l46.1,29.63A40,40,0,1,0,176,160Zm0-128a24,24,0,1,1-24,24A24,24,0,0,1,176,32ZM64,152a24,24,0,1,1,24-24A24,24,0,0,1,64,152Zm112,72a24,24,0,1,1,24-24A24,24,0,0,1,176,224Z",
  card: "M224,48H32A16,16,0,0,0,16,64V192a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V64A16,16,0,0,0,224,48Zm0,16V88H32V64Zm0,128H32V104H224v88Z",
};

const info = (text: string): string =>
  `<span class="info" tabindex="0" role="img" aria-label="${text}" data-tip="${text}">${icon(I.info, "subtle")}</span>`;

const bandwidth = (id: string, label: string, tip: string): string => `
  <div class="metric bw" id="${id}">
    <div class="label-row"><div class="label">${label}</div>${info(tip)}</div>
    <div class="grow"></div>
    <div class="value-row" translate="no"><span class="value" data-value>-</span><span class="unit" data-unit hidden>Mbps</span></div>
    <div class="grow"></div>
    <div class="chart" data-chart></div>
  </div>`;

const latencyLike = (id: string, label: string, tip: string, loaded: boolean): string => `
  <div class="metric small" id="${id}">
    <div class="label-row"><div class="label">${label}</div>${info(tip)}</div>
    <div class="value-row" translate="no"><span class="value" data-value>-</span><span class="unit" data-unit hidden>ms</span></div>
    ${loaded ? `<div class="loaded" translate="no">
      <div class="loaded-item" data-down title="${label} while downloading">${icon(I.arrowDown, "", 14)}<span data-v>0</span><span class="ms">ms</span></div>
      <div class="loaded-item" data-up title="${label} while uploading">${icon(I.arrowUp, "", 14)}<span data-v>0</span><span class="ms">ms</span></div>
    </div>` : ""}
  </div>`;

const score = (key: string, label: string, d: string): string => `
  <li data-score="${key}">
    <div class="score-name">${icon(d)}<span>${label}</span></div>
    <figure class="stars" title="${label} score pending">${Array.from({ length: 5 }, () => `<span class="star">${icon(I.star, "off", 16)}${icon(I.starFill, "on", 16)}</span>`).join("")}<span class="sr-only" data-score-text>${label} score pending</span></figure>
  </li>`;

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f5f5f2">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0c1d31">
<meta name="description" content="Measure the download, upload, latency and jitter between your browser and a Datum Cloud compute instance.">
<title>Speed Test · Datum</title>
${THEME_SCRIPT}
${FONTS}
<style>${THEME_CSS}
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .icon { display: block; flex: none; }
  .icon.subtle { color: var(--text-subtle); }
  [hidden] { display: none !important; }

  /* body: h-full px-4 lg:px-6; container max-width 1440, flex col gap-3 lg:gap-6 */
  body { padding: 0 16px; }
  .shell { min-height: 100%; max-width: 1440px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }

  /* header: py-2 lg:py-4, border-b-2; logo h-7; title 20px / 24px bold, mx-2 */
  .site { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 2px solid var(--line); }
  .brand { display: flex; align-items: center; color: inherit; text-decoration: none; min-width: 0; }
  .brand .logo { height: 24px; width: auto; display: block; flex: none; }
  .brand .divider { width: 1px; height: 24px; background: var(--line); margin: 0 4px 0 14px; flex: none; }
  .brand .title { margin: 0 8px; font-size: 20px; font-weight: 700; white-space: nowrap; letter-spacing: -.01em; }
  .icon-btn {
    display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0;
    border: 0; border-radius: 8px; background: none; color: var(--text); cursor: pointer;
  }
  .icon-btn:hover { background: var(--tint); }
  .theme-icon { display: none; }
  :root[data-theme-choice="system"] .theme-icon.system,
  :root[data-theme-choice="light"] .theme-icon.light,
  :root[data-theme-choice="dark"] .theme-icon.dark { display: block; }
  :root:not([data-theme-choice]) .theme-icon.system { display: block; }

  /* grid: gap-x-4 gap-y-4 lg:gap-y-6; areas 'overview' 'map' / 'overview map' / 'overview overview map' */
  main { flex: 1; }
  .grid { display: grid; grid-auto-columns: 1fr; grid-template-areas: "overview" "map"; gap: 16px; align-items: stretch; }
  .overview { grid-area: overview; position: relative; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .map-panel { grid-area: map; min-width: 0; }

  .overview-body { display: flex; flex-direction: column; gap: 16px; border-radius: 6px; overflow: hidden; transition: filter .3s, opacity .3s; }
  .gated .overview-body { filter: blur(7px); opacity: .45; pointer-events: none; user-select: none; }

  section.block { display: flex; flex-direction: column; gap: 8px; }
  .block-head { display: flex; align-items: center; gap: 4px; }
  .block-head h1, .block-head h2 { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.5; }
  .block-head .learn { margin-left: 4px; font-size: 12px; font-weight: 600; text-decoration: none; }
  .block-head .learn:hover { text-decoration: underline; }
  .speed .block-head { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

  .speed-body { display: flex; flex-direction: column; gap: 24px; }
  /* metrics: flex col xl:flex-row gap-x-4 gap-y-6 min-h-[280px] */
  .metrics { flex: 1; display: flex; flex-direction: column; gap: 24px 16px; min-height: 280px; }
  .metric { display: flex; flex-direction: column; min-width: 0; }
  .metric.bw { flex: 1; gap: 4px; }
  .metric.small { flex: 1; gap: 8px; }
  .label-row { display: flex; align-items: center; gap: 4px; }
  .label { font-size: 14px; font-weight: 600; }
  .info { display: inline-flex; position: relative; cursor: help; }
  .info:hover::after, .info:focus::after {
    content: attr(data-tip); position: absolute; left: 50%; bottom: calc(100% + 6px); transform: translateX(-50%);
    width: max-content; max-width: 260px; padding: 6px 10px; border-radius: 6px; z-index: 10;
    background: var(--text); color: var(--background); font-size: 12px; font-weight: 500; line-height: 1.4;
  }
  .grow { flex: 1; }
  .value-row { display: flex; align-items: baseline; gap: 4px; }
  .value { font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -.02em; transition: font-size .25s; }
  .unit { font-size: 16px; font-weight: 500; color: var(--text-subtle); line-height: 1; }
  .bw .value { font-size: 30px; }
  .bw.big .value { font-size: 50px; }
  .small .value { font-size: 30px; }
  /* chart: mt-auto h-[60px] xl:h-[180px] */
  .chart { margin-top: auto; height: 60px; }
  .chart svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .chart .track { stroke: var(--line); stroke-width: 1; }
  .chart .result { stroke-dasharray: 3 3; stroke-width: 1; opacity: .7; }
  #m-down .chart { color: var(--chart-down); }
  #m-up .chart { color: var(--chart-up); }

  /* side column: flex xl:flex-col gap-x-3 gap-y-4 min-w-[160px] */
  .side { display: flex; gap: 16px 12px; min-width: 160px; }
  .loaded { display: flex; flex-direction: column; gap: 6px 8px; margin-top: 4px; visibility: hidden; }
  .loaded.shown { visibility: visible; }
  .loaded-item { display: flex; align-items: center; gap: 2px; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .loaded-item .icon { color: var(--text-subtle); }
  .loaded-item .ms { font-weight: 500; margin-left: 3px; color: var(--text-subtle); }

  /* controls: two buttons, status text 13px bold, progress h 18px */
  .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .ctl-btn {
    display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0;
    border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text); cursor: pointer;
    box-shadow: 0 1px 2px #0c1d310d;
  }
  .ctl-btn:disabled { color: var(--text-subtle); cursor: not-allowed; opacity: .6; }
  .ctl-btn:not(:disabled):hover { background: var(--tint); }
  .ctl-btn .pause { display: none; }
  .ctl-btn.running .pause { display: block; }
  .ctl-btn.running .play { display: none; }
  .status { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .status-text { font-size: 13px; font-weight: 700; line-height: 1; }
  .progress { display: flex; align-items: stretch; height: 18px; gap: 0; }
  .progress i {
    flex: 1 1 0; min-width: 0; background: var(--progress-todo);
    clip-path: polygon(0 0, calc(100% - 2.5px) 0, 100% 50%, calc(100% - 2.5px) 100%, 0 100%, 2.5px 50%);
    transition: background .2s;
  }
  .progress i.done { background: var(--progress-done); }

  /* quality: ul flex justify-evenly gap-3 rounded-md border p-4 */
  .scores { list-style: none; margin: 0; padding: 16px; display: flex; justify-content: space-evenly; gap: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
  .scores li { display: flex; flex-direction: column; align-items: center; gap: 1px 4px; font-size: 13px; font-weight: 500; color: var(--text-strong); }
  .score-name { display: flex; align-items: center; gap: 6px; min-width: max-content; }
  .stars { display: flex; align-items: center; gap: 1px; margin: 0; }
  .star { position: relative; color: var(--score-off); }
  .star .on { display: none; }
  .star.lit { color: var(--score-on); }
  .star.lit .on { display: block; }
  .star.lit .off { display: none; }

  /* start gate: absolute inset-0 lg:top-9, flex col xl:flex-row, gap-6 */
  .gate { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 24px; padding: 24px 16px; }
  .gated .gate { display: flex; }
  .start-btn {
    width: 136px; height: 136px; flex: none; border-radius: 50%; border: 2px solid var(--line); background: var(--surface);
    color: var(--text-subtle); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
    font: 500 14px/1 var(--sans); letter-spacing: .02em; text-transform: uppercase; cursor: pointer;
    box-shadow: 0 2px 6px #0c1d311f, inset 0 0 0 4px var(--surface);
    transition: color .15s, border-color .15s, transform .15s;
  }
  .start-btn .icon { color: var(--text-subtle); transition: color .15s; }
  .start-btn:hover { color: var(--text); border-color: var(--brand); transform: scale(1.02); }
  .start-btn:hover .icon { color: var(--brand); }
  .gate-copy { max-width: 46ch; display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .gate-copy p { margin: 0; font-size: 14px; color: var(--text-strong); }
  .link-btn { border: 0; padding: 0; background: none; font: inherit; font-weight: 600; color: var(--link); cursor: pointer; text-underline-offset: 2px; }
  .link-btn:hover { text-decoration: underline; }

  dialog.privacy {
    border: 0; padding: 24px; border-radius: 12px; max-width: 560px; width: calc(100% - 32px);
    background: var(--surface); color: var(--text); box-shadow: 0 20px 50px #0c1d3140;
  }
  dialog.privacy::backdrop { background: #0c1d3166; }
  .privacy-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
  .privacy-head h2 { margin: 0; font-size: 20px; font-weight: 600; }
  .privacy-body { display: grid; gap: 16px; line-height: 1.5rem; color: var(--text-subtle); font-size: 15px; }
  .privacy-body p, .privacy-body ul { margin: 0; }
  .privacy-body ul { margin-top: 8px; padding-left: 20px; }
  .privacy-body .note { font-weight: 600; color: var(--text); }

  /* map panel: rounded-md border p-4, map then details (mt-[10px], gap-2) */
  .map-box { display: flex; flex-direction: column; height: 100%; padding: 16px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
  .map { position: relative; flex: 1; min-height: 300px; border-radius: 6px; overflow: hidden; background: var(--map-water); }
  /* .map scoping outranks MapLibre's own .maplibregl-map { position: relative }. */
  .map .map-canvas { position: absolute; inset: 0; }
  .map-canvas .maplibregl-canvas:focus-visible { outline: none; }
  /* MapLibre markers: the server's filled pin with a halo, the client's ring. */
  .server-pin { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in oklab, var(--brand) 22%, transparent); }
  .server-pin::after { content: ""; width: 12px; height: 12px; border-radius: 50%; background: var(--brand); box-shadow: 0 0 0 2px var(--surface); }
  .client-pin { width: 12px; height: 12px; border-radius: 50%; background: var(--surface); box-shadow: 0 0 0 2.5px var(--text); }
  .map-zoom { position: absolute; z-index: 2; right: 16px; bottom: 56px; display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); overflow: hidden; }
  .map-zoom button { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border: 0; background: none; color: var(--text); cursor: pointer; padding: 0; }
  .map-zoom button + button { border-top: 1px solid var(--line); }
  .map-zoom button:hover { background: var(--tint); }
  .map-credit { position: absolute; z-index: 2; right: 16px; bottom: 16px; max-width: calc(100% - 32px); padding: 3px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); font-size: 12px; line-height: 1.4; text-align: right; color: var(--text-subtle); }
  .map-credit a { text-decoration: none; }
  .details { display: grid; gap: 8px; margin: 10px 0 0; padding: 0; list-style: none; font-size: 14px; min-height: 64.5px; }
  .details li { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .details .icon { color: var(--text-subtle); }
  .details .k { white-space: nowrap; }
  .details .v { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .details .v.link { color: var(--link); }
  .details .v a { text-decoration: none; }
  .details .v a:hover { text-decoration: underline; }

  /* footer: border-t py-3 lg:py-4 mt-1.5 lg:mt-0, links px-3 py-1 with dividers */
  .page-footer { border-top: 1px solid var(--line); padding: 12px 0; margin-top: 6px; color: var(--text-strong); }
  .page-footer .row { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; }
  .page-footer p { width: 100%; margin: 0; padding: 0 8px; text-align: center; }
  .footer-menu { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; }
  .footer-menu a { position: relative; padding: 4px 12px; color: inherit; text-decoration: none; }
  .footer-menu a:hover { text-decoration: underline; }
  .footer-menu a + a::before { content: ""; position: absolute; left: 0; top: 25%; height: 50%; width: 1px; background: var(--line); }

  @media (min-width: 487px) { .brand .title { font-size: 24px; } }
  @media (min-width: 640px) {
    .loaded { flex-direction: row; flex-wrap: wrap; }
  }
  @media (min-width: 768px) {
    .overview-body { gap: 24px; }
    .scores li { align-items: flex-start; }
    .loaded-item { flex: 1; }
    .page-footer .row { justify-content: space-between; }
    .page-footer p { width: auto; text-align: left; }
    .footer-menu { justify-content: flex-end; margin-right: -12px; }
  }
  @media (min-width: 1024px) {
    body { padding: 0 24px; }
    .shell { gap: 24px; }
    .site { padding: 16px 0; }
    .grid { grid-template-areas: "overview map"; row-gap: 24px; }
    .overview { gap: 24px; }
    .speed .block-head { position: static; width: auto; height: auto; overflow: visible; clip: auto; }
    .speed-body { padding-top: 4px; }
    .gate { top: 36px; }
    .page-footer { padding: 16px 0; margin-top: 0; }
  }
  @media (min-width: 1280px) {
    .grid { grid-template-areas: "overview overview map"; }
    .metrics { flex-direction: row; }
    .chart { height: 180px; }
    .side { flex-direction: column; }
    .gate { flex-direction: row; }
    .gate-copy { align-items: flex-start; }
  }
</style>
</head>
<body>
<div class="shell">
  <header class="site">
    <a class="brand" href="/" aria-label="Datum Speed Test">${LOGO}<span class="divider" aria-hidden="true"></span><span class="title">Speed Test</span></a>
    <button class="icon-btn" type="button" data-theme-cycle aria-label="Appearance">
      ${icon(I.desktop, "theme-icon system")}${icon(I.sun, "theme-icon light")}${icon(I.moon, "theme-icon dark")}
    </button>
  </header>

  <main>
    <div class="grid">
      <div class="overview gated" id="overview">
        <div class="overview-body" inert>
          <section class="block speed">
            <header class="block-head"><h1>Your Internet Speed</h1></header>
            <div class="speed-body">
              <div class="metrics">
                ${bandwidth("m-down", "Download", "How fast data reaches you from this Datum instance: the 90th percentile of the per-request rates.")}
                ${bandwidth("m-up", "Upload", "How fast data you send reaches this Datum instance: the 90th percentile of the per-request rates.")}
                <div class="side">
                  ${latencyLike("m-latency", "Latency", "Round-trip time to the instance while the connection is idle (median). Arrows: while downloading and uploading.", true)}
                  ${latencyLike("m-jitter", "Jitter", "Average change between consecutive latency samples. Arrows: while downloading and uploading.", true)}
                  <div class="metric small" id="m-loss">
                    <div class="label-row"><div class="label">Packet Loss</div>${info("Not measured here. Browsers can only measure packet loss over WebRTC through a TURN relay, and this test has none. Scores treat it as unknown.")}</div>
                    <div class="value-row" translate="no"><span class="value" data-value>-</span></div>
                  </div>
                </div>
              </div>
              <div class="controls">
                <button class="ctl-btn" id="toggle" type="button" aria-label="Resume" disabled>${icon(I.play, "play")}${icon(I.pause, "pause")}</button>
                <button class="ctl-btn" id="retest" type="button" aria-label="Retest" disabled>${icon(I.retest)}</button>
                <div class="status">
                  <span class="status-text" id="status" aria-live="polite">Paused</span>
                  <div class="progress" id="progress" aria-hidden="true"></div>
                </div>
              </div>
            </div>
          </section>

          <section class="block quality">
            <header class="block-head">
              <h2>Network Quality Score</h2>${info("How well this connection suits each use, scored from the results with Cloudflare's Aggregated Internet Measurement (AIM) rules.")}
              <a class="learn" href="https://developers.cloudflare.com/fundamentals/speed/aim/" target="_blank" rel="noopener">Learn more</a>
            </header>
            <ul class="scores">
              ${score("streaming", "Streaming", I.streaming)}
              ${score("gaming", "Gaming", I.gaming)}
              ${score("rtc", "Video Calls", I.video)}
            </ul>
          </section>
        </div>

        <section class="gate" aria-label="Start">
          <button class="start-btn" id="start" type="button">${icon(I.start, "", 48)}<span>Start</span></button>
          <div class="gate-copy">
            <p>When you run Speed Test, your browser exchanges test data with a Datum Cloud compute instance, which sees your IP address. Results stay in your browser. <button class="link-btn" type="button" id="learn-privacy">Learn More</button></p>
          </div>
        </section>
      </div>

      <section class="block map-panel">
        <header class="block-head"><h2>Server Location</h2>${info("The Datum Cloud location of the compute instance that served this test.")}</header>
        <div class="map-box">
          <div class="map" id="map">
            <div class="map-canvas" id="map-canvas"></div>
            <div class="map-zoom"><button type="button" id="zoom-in" aria-label="Zoom in">${icon(I.plus, "", 16)}</button><button type="button" id="zoom-out" aria-label="Zoom out">${icon(I.minus, "", 16)}</button></div>
            <div class="map-credit"><a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="https://db-ip.com" target="_blank" rel="noopener">DB-IP</a></div>
          </div>
          <ul class="details">
            <li>${icon(I.network, "", 14)}<span class="k">Connected via</span> <span class="v" id="d-family">…</span></li>
            <li>${icon(I.pin, "", 14)}<span class="k">Server location:</span> <span class="v" id="d-location">…</span></li>
            <li id="d-instance-row">${icon(I.server, "", 14)}<span class="k">Served by:</span> <span class="v" id="d-instance">…</span></li>
            <li id="d-network-row">${icon(I.share, "", 14)}<span class="k">Your network:</span> <span class="v" id="d-network">…</span></li>
            <li>${icon(I.card, "", 14)}<span class="k">Your IP address:</span> <span class="v link" id="d-ip">…</span></li>
          </ul>
        </div>
      </section>
    </div>
  </main>

  <footer class="page-footer">
    <div class="row">
      <p>Inspired by <a href="https://speed.cloudflare.com/">speed.cloudflare.com</a></p>
      <nav class="footer-menu" aria-label="Footer">
        <a href="https://www.datum.net/">Home</a>
        <a href="https://www.datum.net/locations">Locations</a>
        <a href="https://www.datum.net/legal/privacy">Privacy Policy</a>
        <a href="https://www.datum.net/legal/terms">Terms of Use</a>
      </nav>
    </div>
  </footer>
</div>

<dialog class="privacy" id="privacy-dialog" aria-labelledby="privacy-title">
  <div class="privacy-head">
    <h2 id="privacy-title">Privacy and Speed Test</h2>
    <button class="icon-btn" type="button" id="privacy-close" aria-label="Close">${icon(I.close)}</button>
  </div>
  <div class="privacy-body">
    <p>Speed Test measures your connection by downloading data from, and uploading data to, the Datum Cloud compute instance that served this page. Like any web server, that instance receives the IP address you connect from.</p>
    <div>
      <p>During the test the instance:</p>
      <ul>
        <li>sends you random data, and receives and discards the data you upload;</li>
        <li>reports your IP address back to this page, cut to /24 (IPv4) or /48 (IPv6) for display;</li>
        <li>looks up which network (ASN) your address belongs to, and roughly where it is for the map, in copies of DB-IP's databases kept on the instance;</li>
        <li>keeps no log of your requests or results.</li>
      </ul>
    </div>
    <p>The map comes from OpenFreeMap's tile servers, which your browser contacts directly, so they see your IP address as any website does.</p>
    <p>The results are computed in your browser by Cloudflare's open-source measurement engine and are not sent anywhere: not to Datum and not to Cloudflare.</p>
    <a href="https://www.datum.net/legal/privacy" target="_blank" rel="noopener">Datum Privacy Policy</a>
    <p class="note">Note: on a fast connection a test can transfer several hundred MB of data.</p>
  </div>
</dialog>

<link rel="stylesheet" href="/client.css">
<script type="module" src="/client.js"></script>
</body>
</html>`;
