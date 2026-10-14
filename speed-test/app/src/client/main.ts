// Runs Cloudflare's measurement engine against this server and draws the
// results into the page from ../page.ts. Bundled by esbuild into dist/client.js.
import SpeedTest, { type MeasurementConfig, type Results } from "@cloudflare/speedtest";
import { geoInterpolate } from "d3-geo";
import { area, curveMonotoneX, line } from "d3-shape";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MARK } from "../theme.js";

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

// An area chart of the per-request rates in order, like speed.cloudflare.com:
// a smooth line with the area under it filled, strongest under the line and
// fading toward the baseline. The dashed line is the reported result.
function drawChart(el: HTMLElement, points: { bps: number }[], result: number | undefined): void {
  if (!points.length) {
    el.innerHTML = "";
    return;
  }
  const w = el.clientWidth || 300;
  const h = el.clientHeight || 60;
  const top = 4;
  const max = Math.max(...points.map((p) => p.bps), result ?? 0) * 1.1;
  // One point still draws a flat band across the chart.
  const data = points.length === 1 ? [points[0], points[0]] : points;
  const x = (i: number) => (i * w) / (data.length - 1);
  const y = (v: number) => h - (v / max) * (h - top);
  const curve = line<{ bps: number }>().x((_, i) => x(i)).y((p) => y(p.bps)).curve(curveMonotoneX);
  const fill = area<{ bps: number }>().x((_, i) => x(i)).y0(h).y1((p) => y(p.bps)).curve(curveMonotoneX);
  const gradient = `fill-${el.parentElement?.id ?? "chart"}`;
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Per-request rates">
    <defs><linearGradient id="${gradient}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="currentColor" stop-opacity=".45"/>
      <stop offset="1" stop-color="currentColor" stop-opacity=".04"/>
    </linearGradient></defs>
    <path d="${fill(data) ?? ""}" fill="url(#${gradient})"/>
    <path d="${curve(data) ?? ""}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    ${result ? `<line class="result" x1="0" x2="${w}" y1="${y(result)}" y2="${y(result)}" stroke="currentColor" vector-effect="non-scaling-stroke"/>` : ""}
    <line class="track" x1="0" x2="${w}" y1="${h - 0.5}" y2="${h - 0.5}" vector-effect="non-scaling-stroke"/>
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
  resizeTimer = window.setTimeout(render, 100);
});

// --- server location ----------------------------------------------------------

interface Meta {
  location: string;
  instance: string | null;
  client: {
    ip: string;
    family: string;
    network: { asn: number; org: string } | null;
    place: { lat: number; lon: number; city: string; country: string } | null;
  };
}

let server: { lat: number; lon: number } | null = null;
let client: { lat: number; lon: number; city: string; country: string } | null = null;

// The map is OpenFreeMap's Positron basemap (OpenStreetMap data in the
// OpenMapTiles schema, drawn by MapLibre), recolored by role from the
// --map-* tokens in theme.ts so it follows Datum's palette and the theme.
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

// MapLibre takes sRGB colors; the tokens are oklch, so let the browser
// convert them by painting one pixel.
const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
function token(name: string): string {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

function recolor(map: maplibregl.Map): void {
  const c = {
    land: token("--map-land"),
    water: token("--map-water"),
    park: token("--map-park"),
    road: token("--map-road"),
    casing: token("--map-road-casing"),
    border: token("--map-border"),
    label: token("--map-label"),
    minor: token("--map-label-minor"),
    halo: token("--map-halo"),
    brand: token("--brand"),
  };
  for (const layer of map.getStyle().layers) {
    const id = layer.id;
    const src = "source-layer" in layer ? layer["source-layer"] : "";
    const set = (prop: keyof maplibregl.AllPaintProperties, value: string) => map.setPaintProperty(id, prop, value);
    if (layer.type === "background") set("background-color", c.land);
    else if (layer.type === "fill") {
      if (src === "water") set("fill-color", c.water);
      else if (src === "park" || id.includes("wood")) set("fill-color", c.park);
      else if (src === "transportation" || src === "aeroway") set("fill-color", c.road);
      else {
        set("fill-color", c.land);
        if (src === "building") set("fill-outline-color", c.casing);
      }
    } else if (layer.type === "line") {
      if (id === "route") set("line-color", c.brand);
      else if (src === "waterway") set("line-color", c.water);
      else if (src === "boundary") set("line-color", c.border);
      else set("line-color", id.includes("casing") ? c.casing : c.road);
    } else if (layer.type === "symbol") {
      set("text-color", src === "place" ? c.label : c.minor);
      set("text-halo-color", c.halo);
    }
  }
}

// The great circle between the two ends as a line of short segments, with
// longitudes kept continuous so a route across the antimeridian doesn't
// wrap the long way round.
function routeCoordinates(): [number, number][] {
  if (!server || !client) return [];
  const along = geoInterpolate([client.lon, client.lat], [server.lon, server.lat]);
  const coords: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    let [lon, lat] = along(i / 64);
    const prev = coords[coords.length - 1];
    if (prev) while (lon - prev[0] > 180) lon -= 360;
    if (prev) while (lon - prev[0] < -180) lon += 360;
    coords.push([lon, lat]);
  }
  return coords;
}

function pin(className: string, title: string, inner = ""): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  el.title = title;
  el.innerHTML = inner;
  return el;
}

// The server end wears the Datum mark, as Cloudflare's map puts its logo on
// the data center that served the test.
const SERVER_BADGE = `<svg viewBox="-1 -1.4 150 150" aria-hidden="true"><path d="${MARK}"/></svg>`;

let map: maplibregl.Map | null = null;
try {
  maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
  map = new maplibregl.Map({
    container: "map-canvas",
    style: STYLE_URL,
    center: [-97, 36],
    zoom: 2.6,
    attributionControl: false, // the credit pill in page.ts carries it
    scrollZoom: false, // don't take over page scrolling
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.on("style.load", () => {
    map!.addSource("route", { type: "geojson", data: { type: "LineString", coordinates: routeCoordinates() } });
    map!.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round" }, paint: { "line-width": 2.5 } });
    recolor(map!);
  });
  window.addEventListener("themechange", () => {
    if (map?.isStyleLoaded()) recolor(map);
  });
} catch (err) {
  console.error("map:", err); // no WebGL: the panel keeps its water color
}

// Like Cloudflare's map: frame the client's rough place and the server with
// the route between them, or the region around the server alone. Never zoom
// in past about a region, so a client in the server's metro still sees some
// map around the pair.
function showPlaces(): void {
  if (!map || !server) return;
  const m = map;
  new maplibregl.Marker({ element: pin("server-pin", "Datum server", SERVER_BADGE) }).setLngLat([server.lon, server.lat]).addTo(m);
  if (!client) {
    m.jumpTo({ center: [server.lon, server.lat], zoom: 3.4 });
    return;
  }
  const where = [client.city, client.country].filter(Boolean).join(", ");
  new maplibregl.Marker({ element: pin("client-pin", `You${where ? `: ${where}` : ""} (approximate)`) })
    .setLngLat([client.lon, client.lat])
    .addTo(m);
  const coords = routeCoordinates();
  const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  m.fitBounds(bounds, { padding: { top: 40, right: 72, bottom: 72, left: 72 }, maxZoom: 4.2, animate: false });
  // If the style hasn't loaded yet, its style.load handler adds the route
  // from routeCoordinates() itself.
  (m.getSource("route") as maplibregl.GeoJSONSource | undefined)?.setData({ type: "LineString", coordinates: coords });
}

$("#zoom-in").addEventListener("click", () => map?.zoomIn());
$("#zoom-out").addEventListener("click", () => map?.zoomOut());

async function loadMeta(): Promise<void> {
  try {
    const meta: Meta = await (await fetch("/__meta", { cache: "no-store" })).json();
    const loc = LOCATIONS[meta.location];
    server = loc ?? null;
    client = meta.client.place;
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
  showPlaces();
}

loadMeta();
