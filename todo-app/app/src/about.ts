// GET /about: how the app is deployed, as a diagram and a few short points.
import { FONTS, THEME_CSS, THEME_SCRIPT, header } from "./theme.js";

export const ABOUT = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#fcfdf7">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0c1d31">
<title>About · Todos · Datum</title>
${THEME_SCRIPT}
${FONTS}
<style>${THEME_CSS}
  :root {
    --c-https: var(--canyon-clay); --c-vpc: var(--pine-forge); --c-iroh: #4d809d; --c-local: var(--utility-3);
    --zone-mac: oklch(95.6% .006 260); --zone-net: oklch(95.6% .003 100); --zone-cloud: oklch(95.4% .008 160);
    --halo: oklch(95.6% .004 120);
  }
  :root.dark {
      --c-https: oklch(78% .07 25); --c-vpc: oklch(77.6% .05 152.7); --c-iroh: var(--aurora-moss); --c-local: var(--utility-4);
      --zone-mac: oklch(30.8% .038 253.5 / .32); --zone-net: oklch(30.8% .038 253.5 / .2); --zone-cloud: oklch(34% .04 230 / .3);
      --halo: oklch(26% .043 253.6);
  }
  .diagram { overflow-x: auto; padding: 12px; }
  .diagram svg { display: block; width: 100%; min-width: 900px; height: auto; }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 22px; margin: 0; padding: 4px 20px 18px; list-style: none; font-size: 13px; color: var(--muted); }
  .legend li { display: flex; align-items: center; gap: 8px; }
  .legend svg { width: 40px; height: 12px; }
  ul.points { margin: 0; padding: 0 0 0 18px; display: grid; gap: 10px; max-width: 72ch; }
  ul.points li::marker { color: var(--primary); }
  a.pill { text-decoration: none; }
  a.pill:hover { color: var(--foreground); }

  .zone-mac { fill: var(--zone-mac); } .zone-net { fill: var(--zone-net); } .zone-cloud { fill: var(--zone-cloud); }
  .box { fill: var(--card); stroke: var(--border); }
  .box-2 { fill: var(--card-inset); stroke: var(--border); }
  .z { font: 500 11px var(--sans); letter-spacing: .12em; fill: var(--muted); }
  .t { font: 500 14px var(--sans); fill: var(--foreground); }
  .m { font: 11.5px var(--mono); fill: var(--foreground); }
  .s { font: 11.5px var(--sans); fill: var(--muted); }
  .lbl { font: 500 11.5px var(--sans); paint-order: stroke; stroke: var(--halo); stroke-width: 4px; stroke-linejoin: round; }
  .l-https { fill: var(--c-https); } .l-vpc { fill: var(--c-vpc); } .l-iroh { fill: var(--c-iroh); } .l-local { fill: var(--c-local); }
  .c { fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .c-https { stroke: var(--c-https); stroke-width: 3; }
  .c-proxy { stroke: var(--c-https); stroke-width: 2; stroke-dasharray: 7 4; stroke-linecap: butt; }
  .c-vpc { stroke: var(--c-vpc); stroke-width: 2.5; }
  .c-iroh { stroke: var(--c-iroh); stroke-width: 3.5; stroke-dasharray: 11 5; stroke-linecap: butt; }
  .c-local { stroke: var(--c-local); stroke-width: 2; stroke-dasharray: 1 4; }
  .a-https { fill: var(--c-https); } .a-vpc { fill: var(--c-vpc); } .a-iroh { fill: var(--c-iroh); } .a-local { fill: var(--c-local); }
</style>
</head>
<body>
<div class="page">
${header("About this app", "How the todo app runs on Datum Cloud, and how a laptop joins its private network.", '<a class="pill" href="/">Back to todos</a>')}
<section class="panel">
  <div class="panel-head"><span class="label">Topology</span><span class="label">us-central-1</span></div>
  <div class="diagram">
<svg viewBox="0 0 1160 600" role="img" aria-label="Topology: browser to Datum proxy to todo-app to todo-db; a laptop joins the private network through an iroh tunnel to vpc-gateway">
  <defs>
    <marker id="h-https" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="a-https"/></marker>
    <marker id="h-vpc" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="a-vpc"/></marker>
    <marker id="h-iroh" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="a-iroh"/></marker>
    <marker id="h-local" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="a-local"/></marker>
  </defs>

  <rect class="zone-mac" x="20" y="20" width="270" height="400" rx="10"/>
  <text class="z" x="36" y="44">LAPTOP</text>
  <rect class="zone-net" x="320" y="20" width="280" height="560" rx="10"/>
  <text class="z" x="336" y="44">INTERNET</text>
  <rect class="zone-cloud" x="630" y="20" width="510" height="560" rx="10"/>
  <text class="z" x="646" y="44">DATUM CLOUD · PRIVATE NETWORK fd20:0:1::/64</text>

  <rect class="box" x="40" y="70" width="230" height="52" rx="6"/>
  <text class="t" x="155" y="93" text-anchor="middle">psql · curl · ping</text>
  <text class="s" x="155" y="111" text-anchor="middle">use private addresses directly</text>
  <rect class="box" x="40" y="160" width="230" height="84" rx="6"/>
  <text class="t" x="52" y="182">tun device</text>
  <text class="m" x="52" y="202">fd20:0:1::6:0:1</text>
  <text class="s" x="52" y="222">its own address in the network</text>
  <rect class="box" x="40" y="282" width="230" height="64" rx="6"/>
  <text class="t" x="52" y="304">vpc-tun client</text>
  <text class="s" x="52" y="324">carries packets over iroh</text>
  <path class="c c-local" d="M155 122 L155 160" marker-start="url(#h-local)" marker-end="url(#h-local)"/>
  <path class="c c-local" d="M155 244 L155 282" marker-start="url(#h-local)" marker-end="url(#h-local)"/>

  <rect class="box" x="345" y="70" width="230" height="52" rx="6"/>
  <text class="t" x="460" y="93" text-anchor="middle">Browser</text>
  <text class="m" x="460" y="111" text-anchor="middle">todo.draines.com</text>
  <rect class="box" x="345" y="160" width="230" height="64" rx="6"/>
  <text class="t" x="357" y="182">Datum proxy</text>
  <text class="s" x="357" y="202">HTTPS ends here</text>
  <rect class="box" x="345" y="290" width="230" height="64" rx="6"/>
  <text class="t" x="357" y="312">iroh relay</text>
  <text class="s" x="357" y="332">forwards encrypted QUIC</text>
  <path class="c c-https" d="M460 122 L460 158" marker-end="url(#h-https)"/>
  <text class="lbl l-https" x="470" y="145">HTTPS</text>

  <rect class="box" x="655" y="70" width="215" height="84" rx="6"/>
  <text class="t" x="667" y="92">todo-app</text>
  <text class="m" x="667" y="112">fd20:0:1::2:0:0</text>
  <text class="s" x="667" y="132">Node.js unikernel · port 8080</text>
  <rect class="box" x="900" y="70" width="215" height="84" rx="6"/>
  <text class="t" x="912" y="92">todo-db</text>
  <text class="m" x="912" y="112">fd20:0:1::1:0:0</text>
  <text class="s" x="912" y="132">NixOS · PostgreSQL · private</text>
  <rect class="box-2" x="655" y="220" width="460" height="44" rx="6"/>
  <text class="t" x="667" y="247">Network router <tspan class="m">fd20:0:1::1</tspan></text>

  <path class="c c-proxy" d="M575 192 L615 192 L615 112 L653 112" marker-end="url(#h-https)"/>
  <text class="lbl l-https" x="579" y="210">HTTP :8080</text>
  <path class="c c-vpc" d="M762 154 L762 220" marker-start="url(#h-vpc)" marker-end="url(#h-vpc)"/>
  <path class="c c-vpc" d="M1007 154 L1007 220" marker-start="url(#h-vpc)" marker-end="url(#h-vpc)"/>
  <text class="lbl l-vpc" x="885" y="192" text-anchor="middle">PostgreSQL :5432</text>

  <rect class="box" x="655" y="330" width="460" height="130" rx="6"/>
  <text class="t" x="667" y="354">vpc-gateway</text>
  <text class="m" x="1103" y="354" text-anchor="end">fd20:0:1::6:0:0</text>
  <rect class="box-2" x="667" y="368" width="196" height="78" rx="5"/>
  <text class="t" x="679" y="390">eth0</text>
  <text class="s" x="679" y="410">answers for the laptop's</text>
  <text class="s" x="679" y="428">address, forwards packets</text>
  <rect class="box-2" x="907" y="368" width="196" height="78" rx="5"/>
  <text class="t" x="919" y="390">tun device</text>
  <text class="s" x="919" y="410">vpc-tun gateway</text>
  <text class="s" x="919" y="428">listed laptops only</text>
  <path class="c c-local" d="M865 407 L905 407" marker-start="url(#h-local)" marker-end="url(#h-local)"/>
  <path class="c c-vpc" d="M765 264 L765 366" marker-start="url(#h-vpc)" marker-end="url(#h-vpc)"/>

  <path class="c c-iroh" d="M272 314 L343 322" marker-start="url(#h-iroh)"/>
  <path class="c c-iroh" d="M577 322 L612 322 L612 520 L1005 520 L1005 448" marker-end="url(#h-iroh)"/>
  <text class="lbl l-iroh" x="808" y="542" text-anchor="middle">iroh tunnel: encrypted, carries the laptop's IPv6 packets</text>
</svg>
  </div>
  <ul class="legend" aria-label="Connection types">
  <li><svg viewBox="0 0 40 12"><path class="c c-https" d="M2 6 L38 6"/></svg>Public HTTPS</li>
  <li><svg viewBox="0 0 40 12"><path class="c c-proxy" d="M2 6 L38 6"/></svg>Proxy to app</li>
  <li><svg viewBox="0 0 40 12"><path class="c c-vpc" d="M2 6 L38 6"/></svg>Private network</li>
  <li><svg viewBox="0 0 40 12"><path class="c c-iroh" d="M2 6 L38 6"/></svg>iroh tunnel</li>
  <li><svg viewBox="0 0 40 12"><path class="c c-local" d="M2 6 L38 6"/></svg>Inside one machine</li>
</ul>
</section>
<section class="panel">
  <div class="panel-head"><span class="label">How it fits together</span></div>
  <div class="panel-body">
    <ul class="points">
      <li>The only way in from the internet is the Datum proxy. It serves HTTPS for <code>todo.draines.com</code> and forwards to the app on port 8080.</li>
      <li>The app runs as a unikernel. It reaches the database over the private network at <code>fd20:0:1::1:0:0</code>, which has no public address.</li>
      <li>A laptop joins that network through <em>vpc-gateway</em>. An encrypted iroh tunnel carries its packets, through a relay or directly.</li>
      <li>The laptop gets its own address, <code>fd20:0:1::6:0:1</code>, from the gateway's block, so the database reaches it like any other host.</li>
      <li>The gateway accepts only laptops it lists, and only from their assigned address.</li>
    </ul>
  </div>
</section>
</div>
</body>
</html>`;
