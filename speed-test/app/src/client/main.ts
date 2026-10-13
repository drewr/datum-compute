// Runs Cloudflare's measurement engine against this server and draws the
// results into the page from ../page.ts. Bundled by esbuild into dist/client.js.
import SpeedTest, { type MeasurementConfig, type Results } from "@cloudflare/speedtest";
import { geoGraticule10, geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import land110 from "world-atlas/land-110m.json";

// The engine's default sequence (speedtest 1.14) without the packetLoss step,
// which needs a TURN relay, and without the final 250 MB downloads. Each
// direction still stops stepping up once one request takes a second.
const MEASUREMENTS: MeasurementConfig[] = [
  { type: "latency", numPackets: 2 },
  { type: "download", bytes: 1e5, count: 1, bypassMinDuration: true },
  { type: "latency", numPackets: 20 },
  { type: "download", bytes: 1e5, count: 9 },
  { type: "latency", numPackets: 2 },
  { type: "download", bytes: 1e6, count: 8 },
  { type: "latency", numPackets: 2 },
  { type: "upload", bytes: 1e5, count: 8 },
  { type: "latency", numPackets: 2 },
  { type: "upload", bytes: 1e6, count: 6 },
  { type: "latency", numPackets: 2 },
  { type: "download", bytes: 1e7, count: 6 },
  { type: "latency", numPackets: 2 },
  { type: "upload", bytes: 1e7, count: 4 },
  { type: "latency", numPackets: 2 },
  { type: "download", bytes: 25e6, count: 4 },
  { type: "latency", numPackets: 2 },
  { type: "upload", bytes: 25e6, count: 4 },
  { type: "latency", numPackets: 2 },
  { type: "download", bytes: 1e8, count: 3 },
  { type: "latency", numPackets: 2 },
  { type: "upload", bytes: 5e7, count: 3 },
];

const TOTAL_STEPS = MEASUREMENTS.reduce((n, m) => n + (m.type === "latency" ? m.numPackets : "count" in m ? m.count : 0), 0);

// Datum Cloud locations, by the code in the LOCATION env var.
const LOCATIONS: Record<string, { city: string; lat: number; lon: number }> = {
  "us-central-1": { city: "Dallas–Fort Worth", lat: 32.8998, lon: -97.0403 },
  "us-east-1": { city: "Ashburn", lat: 38.9445, lon: -77.4558 },
};

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T => root.querySelector(sel) as T;

// --- formatting ---------------------------------------------------------------

// Three significant digits, like speed.cloudflare.com (8.21, 45.6, 123, 1234).
function sig3(n: number): string {
  if (n >= 100) return Math.round(n).toString();
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}
const mbps = (bps: number | undefined) => (bps === undefined ? undefined : sig3(bps / 1e6));
const ms = (v: number | null | undefined) => (v === undefined || v === null ? undefined : v < 10 ? v.toFixed(1) : Math.round(v).toString());

function setValue(id: string, text: string | undefined): void {
  const el = $(`#${id}`);
  $("[data-value]", el).textContent = text ?? "-";
  const unit = el.querySelector("[data-unit]");
  if (unit) (unit as HTMLElement).hidden = text === undefined;
}

function setLoaded(id: string, down: string | undefined, up: string | undefined): void {
  const el = $(`#${id}`);
  $("[data-down] [data-v]", el).textContent = down ?? "-";
  $("[data-up] [data-v]", el).textContent = up ?? "-";
  $(".loaded", el).classList.toggle("shown", down !== undefined || up !== undefined);
}

// --- charts -------------------------------------------------------------------

// One dot per request, in order, joined by a line; the dashed line is the
// reported result. Points are colored by the file size they came from.
function drawChart(el: HTMLElement, points: { bps: number; bytes: number }[], result: number | undefined): void {
  if (!points.length) {
    el.innerHTML = "";
    return;
  }
  const w = el.clientWidth || 300;
  const h = el.clientHeight || 60;
  const pad = 4;
  const max = Math.max(...points.map((p) => p.bps), result ?? 0) * 1.15;
  const x = (i: number) => pad + (points.length === 1 ? (w - 2 * pad) / 2 : (i * (w - 2 * pad)) / (points.length - 1));
  const y = (v: number) => h - pad - (v / max) * (h - 2 * pad);
  const sizes = [...new Set(points.map((p) => p.bytes))].sort((a, b) => a - b);
  const opacity = (bytes: number) => 0.35 + (0.65 * (sizes.indexOf(bytes) + 1)) / sizes.length;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.bps).toFixed(1)}`).join("");
  const r = h > 100 ? 3 : 2;
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Per-request rates">
    <line class="track" x1="0" x2="${w}" y1="${h - 0.5}" y2="${h - 0.5}"/>
    ${result ? `<line class="result" x1="0" x2="${w}" y1="${y(result)}" y2="${y(result)}" stroke="currentColor"/>` : ""}
    <path d="${line}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" opacity=".55"/>
    ${points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.bps).toFixed(1)}" r="${r}" fill="currentColor" opacity="${opacity(p.bytes).toFixed(2)}"/>`).join("")}
  </svg>`;
}

// --- progress -----------------------------------------------------------------

const SEGMENTS = 48;
const progress = $("#progress");
progress.innerHTML = "<i></i>".repeat(SEGMENTS);

function setProgress(fraction: number): void {
  const lit = Math.round(Math.min(1, fraction) * SEGMENTS);
  progress.querySelectorAll("i").forEach((seg, i) => seg.classList.toggle("done", i < lit));
}

function stepsDone(r: Results): number {
  return r.getUnloadedLatencyPoints().length + r.getDownloadBandwidthPoints().length + r.getUploadBandwidthPoints().length;
}

// --- scores -------------------------------------------------------------------

const CLASS_LABEL = ["Bad", "Poor", "Average", "Good", "Great"];

function setScores(r: Results | null): void {
  const scores = r ? (r.getScores() as Record<string, { classificationIdx: number } | undefined>) : {};
  document.querySelectorAll<HTMLElement>("[data-score]").forEach((li) => {
    const s = scores[li.dataset.score!];
    const name = li.querySelector(".score-name span")!.textContent;
    const text = s ? `${name}: ${CLASS_LABEL[s.classificationIdx]}` : `${name} score pending`;
    li.querySelectorAll(".star").forEach((star, i) => star.classList.toggle("lit", !!s && i <= s.classificationIdx));
    $(".stars", li).setAttribute("title", text);
    $("[data-score-text]", li).textContent = text;
  });
}

// --- the test -----------------------------------------------------------------

const overview = $("#overview");
const toggle = $<HTMLButtonElement>("#toggle");
const retest = $<HTMLButtonElement>("#retest");
const status = $("#status");
const down = $("#m-down");
const up = $("#m-up");

let engine: SpeedTest | null = null;
let current = "";

const STATUS: Record<string, string> = {
  latency: "Measuring latency",
  download: "Measuring download",
  upload: "Measuring upload",
};

function render(): void {
  if (!engine) return;
  const r = engine.results;
  const finished = engine.isFinished;

  const downBw = r.getDownloadBandwidth();
  const upBw = r.getUploadBandwidth();
  setValue("m-down", mbps(downBw));
  setValue("m-up", mbps(upBw));
  // The direction being measured gets the big number; both do once finished.
  down.classList.toggle("big", finished || current !== "upload");
  up.classList.toggle("big", finished || current === "upload");
  drawChart($("[data-chart]", down), r.getDownloadBandwidthPoints(), downBw);
  drawChart($("[data-chart]", up), r.getUploadBandwidthPoints(), upBw);

  setValue("m-latency", ms(r.getUnloadedLatency()));
  setLoaded("m-latency", ms(r.getDownLoadedLatency()), ms(r.getUpLoadedLatency()));
  setValue("m-jitter", ms(r.getUnloadedJitter()));
  setLoaded("m-jitter", ms(r.getDownLoadedJitter()), ms(r.getUpLoadedJitter()));
  setValue("m-loss", finished ? "N/A" : undefined);

  setProgress(finished ? 1 : stepsDone(r) / TOTAL_STEPS);
  setScores(finished ? r : null);
}

function setRunning(running: boolean): void {
  toggle.classList.toggle("running", running);
  toggle.setAttribute("aria-label", running ? "Pause" : "Resume");
  toggle.disabled = !!engine?.isFinished;
  retest.disabled = !engine;
  if (!running && engine && !engine.isFinished) status.textContent = "Paused";
}

function start(): void {
  overview.classList.remove("gated");
  $(".overview-body").removeAttribute("inert");
  engine?.pause();
  current = "";
  setScores(null);
  engine = new SpeedTest({
    autoStart: false,
    downloadApiUrl: `${location.origin}/__down`,
    uploadApiUrl: `${location.origin}/__up`,
    // Never report results to Cloudflare (the default posts them to
    // speed.cloudflare.com/__results).
    logAimApiUrl: null,
    measurements: MEASUREMENTS,
  });
  engine.onRunningChange = setRunning;
  engine.onResultsChange = ({ type }) => {
    if (type !== current && STATUS[type]) {
      current = type;
      status.textContent = STATUS[type];
    }
    render();
  };
  engine.onFinish = () => {
    current = "";
    status.textContent = "Complete";
    render();
    setRunning(false);
  };
  engine.onError = (err) => {
    console.error("speed test:", err);
    status.textContent = `Error: ${err}`;
  };
  render();
  status.textContent = "Starting";
  engine.play();
}

$("#start").addEventListener("click", start);
retest.addEventListener("click", start);
toggle.addEventListener("click", () => {
  if (!engine || engine.isFinished) return;
  if (engine.isRunning) engine.pause();
  else engine.play();
});

const dialog = $<HTMLDialogElement>("#privacy-dialog");
$("#learn-privacy").addEventListener("click", () => dialog.showModal());
$("#privacy-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
});

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    render();
    drawMap();
  }, 100);
});

// --- server location ----------------------------------------------------------

interface Meta {
  location: string;
  instance: string | null;
  client: { ip: string; family: string; network: { asn: number; org: string } | null };
}

const mapEl = $("#map");
const landTopo = land110 as unknown as Topology<{ land: GeometryCollection }>;
const land = feature(landTopo, landTopo.objects.land);
let server: { lat: number; lon: number } | null = null;
let zoom = 1;

function drawMap(): void {
  const w = mapEl.clientWidth;
  const h = mapEl.clientHeight;
  if (!w || !h) return;
  const projection = geoMercator();
  if (server) {
    // Start at roughly a continent around the server, like Cloudflare's map.
    const span = 26 / zoom;
    projection.fitExtent([[0, 0], [w, h]], {
      type: "MultiPoint",
      coordinates: [
        [server.lon - span, server.lat - span * 0.55],
        [server.lon + span, server.lat + span * 0.55],
      ],
    });
    const [px, py] = projection([server.lon, server.lat])!;
    const [tx, ty] = projection.translate();
    projection.translate([tx + w / 2 - px, ty + h / 2 - py]);
  } else {
    projection.fitSize([w, h], { type: "Sphere" }).scale(projection.scale() * zoom);
  }
  const path = geoPath(projection);
  let marker = "";
  if (server) {
    const [x, y] = projection([server.lon, server.lat])!;
    marker = `<circle class="marker-halo" cx="${x}" cy="${y}" r="16"/><circle class="marker" cx="${x}" cy="${y}" r="6"/>`;
  }
  const svg = `<svg class="map-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Map of the server location">
    <path class="graticule" d="${path(geoGraticule10()) ?? ""}"/>
    <path class="land" d="${path(land) ?? ""}"/>
    ${marker}
  </svg>`;
  mapEl.querySelector(".map-svg")?.remove();
  mapEl.insertAdjacentHTML("afterbegin", svg);
}

$("#zoom-in").addEventListener("click", () => {
  zoom = Math.min(zoom * 1.6, 12);
  drawMap();
});
$("#zoom-out").addEventListener("click", () => {
  zoom = Math.max(zoom / 1.6, 0.25);
  drawMap();
});

async function loadMeta(): Promise<void> {
  try {
    const meta: Meta = await (await fetch("/__meta", { cache: "no-store" })).json();
    const loc = LOCATIONS[meta.location];
    server = loc ?? null;
    $("#d-family").textContent = meta.client.family;
    $("#d-location").textContent = loc ? `${loc.city} (${meta.location})` : meta.location || "Unknown";
    $("#d-instance").textContent = meta.instance ?? "";
    $("#d-instance-row").hidden = !meta.instance;
    // "T-Mobile USA, Inc. (AS21928)", the AS number linked like Cloudflare's.
    const net = meta.client.network;
    const netEl = $("#d-network");
    netEl.textContent = net ? `${net.org} (` : "";
    if (net) {
      const a = document.createElement("a");
      a.href = `https://bgp.he.net/AS${net.asn}`;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = `AS${net.asn}`;
      netEl.append(a, ")");
    }
    $("#d-network-row").hidden = !net;
    $("#d-ip").textContent = meta.client.ip;
  } catch (err) {
    console.error("meta:", err);
    for (const id of ["d-family", "d-location", "d-instance", "d-network", "d-ip"]) $(`#${id}`).textContent = "Unavailable";
  }
  drawMap();
}

loadMeta();
