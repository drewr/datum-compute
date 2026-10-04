// Shared look for the app's pages, matching demo.datum.net: Datum's palette
// (midnight fjord, glacier mist, aurora moss, canyon clay), its header with the
// logo, and bordered panels. Light and dark work like the demo: localStorage
// "theme" holds system, light or dark, and a `dark` class on <html> applies it.
// The demo has no visible switch; the header's toggle is styled like its pills.
//
// demo.datum.net's typefaces (Alliance No.1 and others) are licensed and served
// without CORS, so they're used only when installed locally; DM Sans stands in.

export const LOGO = `<svg class="logo" viewBox="0 0 742 148" role="img" aria-label="Datum" xmlns="http://www.w3.org/2000/svg"><path class="logo-mark" d="M55.7665 0.0945983C53.6493 0.0945983 51.9226 1.80458 51.9226 3.91343C51.9226 6.02228 51.9226 41.2271 51.9226 41.2271C51.9226 43.3306 53.6435 44.9511 55.7665 44.9511L74.0043 45.0459C81.5393 45.0459 88.7162 47.9693 94.2155 53.2713C99.7473 58.6112 102.836 65.6608 102.923 73.131C103.01 80.7848 100.073 87.9906 94.6607 93.4275C89.2482 98.8644 82.0279 101.858 74.3301 101.858H74.0043C66.4858 101.772 59.3901 98.7027 54.0158 93.2064C48.6795 87.7481 45.6522 80.612 45.6522 73.1257V54.7924C45.6522 52.6889 44.0161 51.1811 41.8935 51.1811H4.34839C2.23122 51.1811 0.504883 52.6836 0.504883 54.7924V92.106C0.504883 94.2099 2.22574 96.0376 4.34839 96.0376H33.9838C37.9685 96.0376 40.5362 95.9789 42.6534 96.2647C45.4654 96.6425 47.3494 97.4406 48.7718 98.8483C50.1942 100.256 50.9921 102.133 51.3719 104.927C51.6596 107.036 51.9226 109.582 51.9226 113.546V142.985C51.9226 145.089 53.4348 147.124 55.5577 147.124H74.3355C82.7662 147.124 91.045 145.396 98.9439 142.624C128.384 132.284 148.166 104.485 148.166 73.4494C148.166 42.4137 128.384 14.6144 98.9439 4.27474C91.045 1.50229 82.7662 0.0945983 74.3355 0.0945983H55.7719H55.7665Z"/><path class="logo-text" d="M658.436 52.5669H658.235L653.607 111.455H640.929L645.556 38.6199H664.774L691.353 94.9235L718.334 38.6199H737.149L741.777 111.455H729.102L724.474 52.5669H724.273L697.09 111.455H685.719L658.436 52.5669Z"/><path class="logo-text" d="M618.454 80.1951C618.454 86.0727 617.548 91.1154 615.738 95.3231C613.927 99.4642 611.344 102.871 607.992 105.542C604.636 108.214 600.544 110.184 595.715 111.453C590.955 112.655 585.587 113.256 579.616 113.256C573.649 113.256 568.249 112.655 563.417 111.453C558.656 110.184 554.596 108.214 551.244 105.542C547.889 102.871 545.306 99.4642 543.495 95.3231C541.684 91.1154 540.779 86.0727 540.779 80.1951V38.618H555.067V79.1935C555.067 82.1988 555.401 85.0375 556.073 87.709C556.745 90.3141 557.984 92.6182 559.795 94.6219C561.606 96.6256 564.088 98.1953 567.243 99.3308C570.462 100.466 574.586 101.034 579.616 101.034C584.65 101.034 588.738 100.466 591.893 99.3308C595.112 98.1953 597.627 96.6256 599.437 94.6219C601.248 92.6182 602.491 90.3141 603.163 87.709C603.831 85.0375 604.169 82.1988 604.169 79.1935V38.618H618.454V80.1951Z"/><path class="logo-text" d="M471.618 50.8426H438.917V38.6199H518.603V50.8426H485.902V111.455H471.618V50.8426Z"/><path class="logo-text" d="M404.645 82.5012L389.354 50.0413L374.06 82.5012H404.645ZM381.202 38.6199H397.503L433.02 111.455H417.927L410.282 94.7239H368.121L360.375 111.455H345.182L381.202 38.6199Z"/><path class="logo-text" d="M276.737 99.2325C282.841 99.2325 288.006 98.7649 292.232 97.8298C296.524 96.8947 300.011 95.4251 302.695 93.4214C305.447 91.4177 307.423 88.8796 308.634 85.8074C309.906 82.7351 310.545 79.0615 310.545 74.7869C310.545 70.312 309.906 66.5719 308.634 63.5662C307.358 60.494 305.346 58.0227 302.594 56.1525C299.911 54.2822 296.424 52.9465 292.131 52.1451C287.838 51.2769 282.707 50.8426 276.737 50.8426H262.248V99.2325H276.737ZM247.96 38.6199H283.176C288.945 38.6199 294.345 39.2877 299.375 40.6235C304.473 41.8928 308.9 43.9634 312.658 46.8353C316.412 49.6403 319.365 53.3471 321.51 57.9558C323.723 62.4976 324.83 68.0411 324.83 74.5866C324.83 80.798 323.824 86.208 321.812 90.8167C319.8 95.4251 316.983 99.2657 313.362 102.338C309.74 105.411 305.411 107.715 300.381 109.251C295.351 110.72 289.817 111.455 283.78 111.455H247.96V38.6199Z"/></svg>`;

export const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap">`;

// Runs in <head> before first paint, like the demo's, so a stored choice never
// flashes the other theme. Also wires the toggle and follows system changes.
export const THEME_SCRIPT = `<script>
(function () {
  var key = "theme";
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  function stored() { try { return localStorage.getItem(key) || "system"; } catch (e) { return "system"; } }
  function apply(choice) {
    var dark = choice === "dark" || (choice === "system" && media.matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document.querySelectorAll("[data-theme-choice]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-choice") === choice));
    });
  }
  apply(stored());
  media.addEventListener("change", function () { if (stored() === "system") apply("system"); });
  document.addEventListener("DOMContentLoaded", function () { apply(stored()); });
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-theme-choice]");
    if (!b) return;
    var choice = b.getAttribute("data-theme-choice");
    try { localStorage.setItem(key, choice); } catch (err) {}
    apply(choice);
  });
})();
</script>`;

const THEME_TOGGLE = `<div class="theme-toggle" role="group" aria-label="Theme">
    <button type="button" data-theme-choice="system" aria-pressed="true">System</button>
    <button type="button" data-theme-choice="light" aria-pressed="false">Light</button>
    <button type="button" data-theme-choice="dark" aria-pressed="false">Dark</button>
  </div>`;

export const THEME_CSS = `
  :root {
    color-scheme: light;
    --midnight-fjord: oklch(22.8% .045 253.7);
    --glacier-mist: oklch(97.3% .001 106.4);
    --glacier-mist-900: oklch(92.8% .004 91.4);
    --aurora-moss: oklch(94% .11 116.6);
    --canyon-clay: oklch(61% .044 18.4);
    --pine-forge: oklch(47.8% .034 158.9);
    --utility-1: oklch(30.8% .038 253.5);
    --utility-2: oklch(38.6% .032 253.8);
    --utility-3: oklch(54.4% .021 250.7);
    --utility-4: oklch(67% .011 248);
    --utility-5: oklch(91.3% .004 91.4);

    --background: var(--glacier-mist);
    --foreground: var(--midnight-fjord);
    --muted: oklch(52% .012 250);
    --card: #fff;
    --card-inset: oklch(98.4% .002 100);
    --border: var(--glacier-mist-900);
    --primary: var(--canyon-clay);
    --primary-foreground: #fff;
    --live: var(--pine-forge);
    --input-bg: var(--glacier-mist);
    --input-border: var(--utility-5);
    --focus-border: var(--utility-3);
    --focus-shadow: 0 0 0 3px #0c1d3114;
    --danger: oklch(62.1% .151 22.5);
    --wash: radial-gradient(ellipse 70% 55% at 40% 35%, #3e6e961a, transparent 70%);
    --sans: "Alliance No1", "Alliance No.1", "DM Sans", ui-sans-serif, system-ui, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  :root.dark {
      color-scheme: dark;
      --background: var(--midnight-fjord);
      --foreground: var(--glacier-mist);
      --muted: var(--utility-4);
      --card: oklch(30.8% .038 253.5 / .55);
      --card-inset: oklch(26% .04 253.6 / .7);
      --border: var(--utility-2);
      --primary: var(--aurora-moss);
      --primary-foreground: var(--midnight-fjord);
      --live: var(--aurora-moss);
      --input-bg: var(--midnight-fjord);
      --input-border: var(--utility-2);
      --focus-border: var(--aurora-moss);
      --focus-shadow: 0 0 0 3px #ecf9c014;
      --wash: radial-gradient(ellipse 70% 55% at 40% 35%, #3e6e9638, transparent 70%);
  }
  * { box-sizing: border-box; }
  html { background: var(--background); }
  body {
    margin: 0; min-height: 100vh;
    background: var(--wash), var(--background);
    color: var(--foreground);
    font: 14px/1.5 var(--sans);
    -webkit-font-smoothing: antialiased;
  }
  .page { max-width: 1180px; margin: 0 auto; padding: 40px 24px 64px; display: grid; gap: 32px; }
  a { color: var(--primary); text-underline-offset: 3px; }
  code, .mono { font-family: var(--mono); font-size: .92em; }

  header.top { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 20px; color: inherit; text-decoration: none; }
  .logo { height: 26px; width: auto; display: block; }
  .logo-mark { fill: var(--primary); }
  .logo-text { fill: var(--foreground); }
  .divider { width: 1px; align-self: stretch; min-height: 36px; background: var(--border); }
  .heading { flex: 1 1 20rem; min-width: 0; }
  .heading h1 { font: 500 22px/1.2 var(--sans); margin: 0; letter-spacing: -.005em; }
  .heading p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
  .actions { margin-left: auto; flex: none; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .pill {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 14px; border: 1px solid var(--border); border-radius: 999px;
    font: 500 12px/1 var(--sans); letter-spacing: .12em; text-transform: uppercase; color: var(--muted);
    background: var(--card);
  }
  .pill .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--live); }
  .pill.down .dot { background: var(--danger); }
  .theme-toggle { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--border); border-radius: 999px; background: var(--card); }
  .theme-toggle button {
    font: 500 12px/1 var(--sans); letter-spacing: .12em; text-transform: uppercase;
    color: var(--muted); background: none; border: 0; border-radius: 999px; padding: 6px 11px; cursor: pointer;
  }
  .theme-toggle button:hover { color: var(--foreground); }
  .theme-toggle button[aria-pressed="true"] { background: var(--primary); color: var(--primary-foreground); }

  .panel { background: var(--card); border: 1px solid var(--border); border-radius: 12px; }
  .panel-head { display: flex; justify-content: space-between; align-items: baseline; padding: 18px 20px 0; }
  .label { font-size: 13px; color: var(--muted); }
  .panel-body { padding: 14px 20px 20px; }
  .inset { background: var(--card-inset); border: 1px solid var(--border); border-radius: 8px; }

  input[type=text] {
    font: inherit; color: var(--foreground); background: var(--input-bg);
    border: 1px solid var(--input-border); border-radius: 8px; padding: 9px 12px; outline: none;
  }
  input[type=text]::placeholder { color: var(--utility-4); }
  input[type=text]:focus { border-color: var(--focus-border); box-shadow: var(--focus-shadow); }
  .btn {
    font: 500 14px/1 var(--sans); padding: 10px 16px; border-radius: 8px; cursor: pointer;
    color: var(--primary-foreground); background: var(--primary); border: 1px solid var(--primary);
  }
  .btn:hover { filter: brightness(1.05); }
  :focus-visible { outline: 2px solid var(--focus-border); outline-offset: 2px; }
`;

export function header(title: string, subtitle: string, right = ""): string {
  return `<header class="top">
  <a class="brand" href="/">${LOGO}</a>
  <span class="divider" aria-hidden="true"></span>
  <div class="heading"><h1>${title}</h1><p>${subtitle}</p></div>
  <div class="actions">${right}${THEME_TOGGLE}</div>
</header>`;
}
