// Datum's look, taken from ../../todo-app/app/src/theme.ts (itself matching
// demo.datum.net): the logo, DM Sans standing in for the licensed Alliance
// No.1, and the palette (midnight fjord, glacier mist, aurora moss, canyon
// clay). Light and dark work the same way: localStorage "theme" holds system,
// light or dark, and a `dark` class on <html> applies it. Here one icon button
// cycles through the three, like the appearance button on speed.cloudflare.com.

// The mark (the "D" shape) on its own, in the logo's 742 x 148 artwork units.
const MARK = "M55.7665 0.0945983C53.6493 0.0945983 51.9226 1.80458 51.9226 3.91343C51.9226 6.02228 51.9226 41.2271 51.9226 41.2271C51.9226 43.3306 53.6435 44.9511 55.7665 44.9511L74.0043 45.0459C81.5393 45.0459 88.7162 47.9693 94.2155 53.2713C99.7473 58.6112 102.836 65.6608 102.923 73.131C103.01 80.7848 100.073 87.9906 94.6607 93.4275C89.2482 98.8644 82.0279 101.858 74.3301 101.858H74.0043C66.4858 101.772 59.3901 98.7027 54.0158 93.2064C48.6795 87.7481 45.6522 80.612 45.6522 73.1257V54.7924C45.6522 52.6889 44.0161 51.1811 41.8935 51.1811H4.34839C2.23122 51.1811 0.504883 52.6836 0.504883 54.7924V92.106C0.504883 94.2099 2.22574 96.0376 4.34839 96.0376H33.9838C37.9685 96.0376 40.5362 95.9789 42.6534 96.2647C45.4654 96.6425 47.3494 97.4406 48.7718 98.8483C50.1942 100.256 50.9921 102.133 51.3719 104.927C51.6596 107.036 51.9226 109.582 51.9226 113.546V142.985C51.9226 145.089 53.4348 147.124 55.5577 147.124H74.3355C82.7662 147.124 91.045 145.396 98.9439 142.624C128.384 132.284 148.166 104.485 148.166 73.4494C148.166 42.4137 128.384 14.6144 98.9439 4.27474C91.045 1.50229 82.7662 0.0945983 74.3355 0.0945983H55.7719H55.7665Z";

export const LOGO = `<svg class="logo" viewBox="0 0 742 148" role="img" aria-label="Datum" xmlns="http://www.w3.org/2000/svg"><path class="logo-mark" d="${MARK}"/><path class="logo-text" d="M658.436 52.5669H658.235L653.607 111.455H640.929L645.556 38.6199H664.774L691.353 94.9235L718.334 38.6199H737.149L741.777 111.455H729.102L724.474 52.5669H724.273L697.09 111.455H685.719L658.436 52.5669Z"/><path class="logo-text" d="M618.454 80.1951C618.454 86.0727 617.548 91.1154 615.738 95.3231C613.927 99.4642 611.344 102.871 607.992 105.542C604.636 108.214 600.544 110.184 595.715 111.453C590.955 112.655 585.587 113.256 579.616 113.256C573.649 113.256 568.249 112.655 563.417 111.453C558.656 110.184 554.596 108.214 551.244 105.542C547.889 102.871 545.306 99.4642 543.495 95.3231C541.684 91.1154 540.779 86.0727 540.779 80.1951V38.618H555.067V79.1935C555.067 82.1988 555.401 85.0375 556.073 87.709C556.745 90.3141 557.984 92.6182 559.795 94.6219C561.606 96.6256 564.088 98.1953 567.243 99.3308C570.462 100.466 574.586 101.034 579.616 101.034C584.65 101.034 588.738 100.466 591.893 99.3308C595.112 98.1953 597.627 96.6256 599.437 94.6219C601.248 92.6182 602.491 90.3141 603.163 87.709C603.831 85.0375 604.169 82.1988 604.169 79.1935V38.618H618.454V80.1951Z"/><path class="logo-text" d="M471.618 50.8426H438.917V38.6199H518.603V50.8426H485.902V111.455H471.618V50.8426Z"/><path class="logo-text" d="M404.645 82.5012L389.354 50.0413L374.06 82.5012H404.645ZM381.202 38.6199H397.503L433.02 111.455H417.927L410.282 94.7239H368.121L360.375 111.455H345.182L381.202 38.6199Z"/><path class="logo-text" d="M276.737 99.2325C282.841 99.2325 288.006 98.7649 292.232 97.8298C296.524 96.8947 300.011 95.4251 302.695 93.4214C305.447 91.4177 307.423 88.8796 308.634 85.8074C309.906 82.7351 310.545 79.0615 310.545 74.7869C310.545 70.312 309.906 66.5719 308.634 63.5662C307.358 60.494 305.346 58.0227 302.594 56.1525C299.911 54.2822 296.424 52.9465 292.131 52.1451C287.838 51.2769 282.707 50.8426 276.737 50.8426H262.248V99.2325H276.737ZM247.96 38.6199H283.176C288.945 38.6199 294.345 39.2877 299.375 40.6235C304.473 41.8928 308.9 43.9634 312.658 46.8353C316.412 49.6403 319.365 53.3471 321.51 57.9558C323.723 62.4976 324.83 68.0411 324.83 74.5866C324.83 80.798 323.824 86.208 321.812 90.8167C319.8 95.4251 316.983 99.2657 313.362 102.338C309.74 105.411 305.411 107.715 300.381 109.251C295.351 110.72 289.817 111.455 283.78 111.455H247.96V38.6199Z"/></svg>`;

// The favicon: the mark in canyon clay, or aurora moss when the browser is
// dark, as the logo is on the page (oklch values from THEME_CSS in sRGB).
// favicon.ico and apple-touch-icon.png in ../static are drawn from it; see
// the README.
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10.5 168.7 168.7"><style>path{fill:#9c7979}@media (prefers-color-scheme:dark){path{fill:#e6f59f}}</style><path d="${MARK}"/></svg>`;

export const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap">`;

// Runs in <head> before first paint so a stored choice never flashes the other
// theme. The [data-theme-cycle] button steps system → light → dark.
export const THEME_SCRIPT = `<script>
(function () {
  var key = "theme", order = ["system", "light", "dark"];
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  function stored() { try { return localStorage.getItem(key) || "system"; } catch (e) { return "system"; } }
  function apply(choice) {
    var dark = choice === "dark" || (choice === "system" && media.matches);
    var root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
    root.setAttribute("data-theme-choice", choice);
    document.querySelectorAll("[data-theme-cycle]").forEach(function (b) {
      b.setAttribute("aria-label", "Appearance: " + choice);
      b.title = "Appearance: " + choice;
    });
    window.dispatchEvent(new Event("themechange"));
  }
  apply(stored());
  media.addEventListener("change", function () { if (stored() === "system") apply("system"); });
  document.addEventListener("DOMContentLoaded", function () { apply(stored()); });
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-theme-cycle]");
    if (!b) return;
    var next = order[(order.indexOf(stored()) + 1) % order.length];
    try { localStorage.setItem(key, next); } catch (err) {}
    apply(next);
  });
})();
</script>`;

// Datum's palette mapped onto the roles speed.cloudflare.com's kumo tokens
// play: default text, subtle text, the 1px lines, tints for empty chart
// tracks, and an accent where Cloudflare uses its blue/orange.
export const THEME_CSS = `
  :root {
    color-scheme: light;
    --midnight-fjord: oklch(22.8% .045 253.7);
    --glacier-mist: oklch(97.3% .001 106.4);
    --glacier-mist-900: oklch(92.8% .004 91.4);
    --aurora-moss: oklch(94% .11 116.6);
    --aurora-moss-deep: oklch(62% .13 125);
    --canyon-clay: oklch(61% .044 18.4);
    --pine-forge: oklch(47.8% .034 158.9);
    --utility-1: oklch(30.8% .038 253.5);
    --utility-2: oklch(38.6% .032 253.8);
    --utility-3: oklch(54.4% .021 250.7);
    --utility-4: oklch(67% .011 248);
    --utility-5: oklch(91.3% .004 91.4);

    --background: var(--glacier-mist);
    --surface: #fff;
    --text: var(--midnight-fjord);
    --text-strong: var(--utility-1);
    --text-subtle: oklch(52% .012 250);
    --line: var(--glacier-mist-900);
    --tint: oklch(95% .003 100);
    --brand: var(--canyon-clay);
    --brand-foreground: #fff;
    --link: var(--canyon-clay);
    --chart-down: var(--pine-forge);
    --chart-up: var(--canyon-clay);
    --progress-done: var(--pine-forge);
    --progress-todo: var(--utility-5);
    /* The map's basemap (OpenFreeMap tiles), recolored by role. */
    --map-land: oklch(96.6% .003 100);
    --map-water: oklch(89.5% .012 240);
    --map-park: oklch(93.5% .012 140);
    --map-road: #fff;
    --map-road-casing: oklch(88% .004 95);
    --map-border: oklch(76% .012 250);
    --map-label: var(--midnight-fjord);
    --map-label-minor: oklch(48% .02 250);
    --map-halo: oklch(96.6% .003 100);
    --score-on: var(--pine-forge);
    --score-off: var(--utility-5);
    --sans: "Alliance No1", "Alliance No.1", "DM Sans", ui-sans-serif, system-ui, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  :root.dark {
    color-scheme: dark;
    --background: var(--midnight-fjord);
    --surface: oklch(25.5% .042 253.6);
    --text: var(--glacier-mist);
    --text-strong: oklch(92% .004 100);
    --text-subtle: var(--utility-4);
    --line: var(--utility-2);
    --tint: var(--utility-1);
    --brand: var(--aurora-moss);
    --brand-foreground: var(--midnight-fjord);
    --link: var(--aurora-moss);
    --chart-down: var(--aurora-moss);
    --chart-up: oklch(72% .06 18.4);
    --progress-done: var(--aurora-moss);
    --progress-todo: var(--utility-2);
    --map-land: oklch(29% .038 253.6);
    --map-water: oklch(21% .042 253.7);
    --map-park: oklch(30.5% .04 200);
    --map-road: oklch(36% .034 253.8);
    --map-road-casing: oklch(33% .036 253.7);
    --map-border: oklch(48% .03 253.8);
    --map-label: oklch(90% .006 100);
    --map-label-minor: var(--utility-4);
    --map-halo: oklch(25% .042 253.7);
    --score-on: var(--aurora-moss);
    --score-off: var(--utility-2);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  html { background: var(--background); }
  body {
    margin: 0;
    background: var(--background);
    color: var(--text);
    font: 16px/1.5 var(--sans);
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--link); text-underline-offset: 2px; }
  :focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
  .logo-mark { fill: var(--brand); }
  .logo-text { fill: var(--text); }
`;
