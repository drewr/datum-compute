import { ThemedLogo } from '@datum-cloud/datum-ui/logo/themed';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { InstanceCard } from './components/InstanceCard';
import { MeshMap } from './components/MeshMap';
import { Narrative } from './components/Narrative';
import { StatsPanel } from './components/StatsPanel';
import { fleetAspect } from './camera';
import { buildIntraLinks, buildLinks, buildRegions } from './mesh';
import { useFeed } from './useFeed';
import { useMesh } from './useMesh';
import { MIN_MAP_ASPECT, type Viewport, usePrefersReducedMotion, useViewport } from './viewport';

const TOUR_MS = 7000;
const IDLE_RESUME_MS = 15000;

export function App() {
  const vp = useViewport();
  const reducedMotion = usePrefersReducedMotion();
  const mapArea = useRef<HTMLDivElement>(null);
  const mapSize = useMapSize(mapArea, vp);
  const { view, receivedAt, stale } = useMesh(2000);
  const feed = useFeed(view);
  const regions = useMemo(() => buildRegions(view), [view]);
  const links = useMemo(() => buildLinks(view, regions), [view, regions]);
  const intraLinks = useMemo(() => buildIntraLinks(view, regions), [view, regions]);

  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Zooming or panning hands the screen to the visitor; the spotlight waits.
  const [steering, setSteering] = useState(false);

  const tour = useTour(
    regions.map((r) => r.location),
    regions.find((r) => r.isSelf)?.location ?? null,
    !!(hovered || selected) || reducedMotion || steering
  );
  const focus = hovered ?? selected ?? tour;
  const selectedRegion = regions.find((r) => r.location === selected) ?? null;
  useDismissOnOutside(!!selected, () => setSelected(null));

  // Stacked layouts give the map the fleet's own shape, so it never sits in
  // a box of empty ocean.
  const mapAspect = useMemo(() => fleetAspect(regions), [regions]);
  // When the fleet's clock said what the page is showing. Fixed to the poll it
  // came from rather than recomputed per render, so "8s ago" does not drift a
  // millisecond at a time and the panel can skip renders it has no news for.
  const servedAt = useMemo(() => Date.now() - Math.max(0, performance.now() - receivedAt), [receivedAt]);

  return (
    <div
      data-layout={vp.mode}
      className={`safe-area relative bg-page font-sans text-ink antialiased ${
        vp.stacked ? 'min-h-[100dvh]' : 'flex h-[100dvh] flex-col overflow-hidden'
      }`}
    >
      <Backdrop />

      <header
        className={`relative z-10 flex items-center justify-between gap-4 ${
          vp.stacked ? 'px-5 pt-4 pb-0' : vp.compact ? 'px-6 pt-5 pb-1' : 'px-12 pt-9 pb-2'
        }`}
      >
        <motion.div
          className={`flex items-center ${vp.compact ? 'gap-3' : 'gap-5'}`}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <ThemedLogo.Flat className={vp.compact ? 'h-5 w-auto' : 'h-7 w-auto'} />
          <span className={`w-px bg-line-15 ${vp.compact ? 'h-5' : 'h-7'}`} />
          <div>
            <h1
              className={`leading-none font-medium tracking-[-0.01em] whitespace-nowrap ${
                vp.compact ? 'text-[17px]' : 'text-[22px]'
              }`}
            >
              Global Mesh
            </h1>
            {!vp.compact && (
              <p className="mt-1.5 text-[13px] text-ink-50">EC2 instances in AWS regions around the world, joined to one private Datum network.</p>
            )}
          </div>
        </motion.div>

        <motion.div
          className={`flex shrink-0 items-center ${vp.compact ? 'gap-2' : 'gap-4'}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          {!vp.compact && (
            <a href="/architecture" className="text-[12px] tracking-[0.08em] text-ink-50 uppercase hover:underline">
              Architecture
            </a>
          )}
          {view?.discovery === 'static' && !vp.compact && (
            <span className="text-[12px] tracking-[0.08em] text-ink-30 uppercase">Static peers</span>
          )}
          {view?.mode === 'simulate' ? (
            <span
              className={`rounded-full border border-line-10 bg-wash-3 font-medium tracking-[0.14em] text-ink-55 uppercase ${
                vp.compact ? 'px-3 py-1 text-[10px]' : 'px-4 py-1.5 text-[12px]'
              }`}
            >
              Simulated
            </span>
          ) : (
            <span
              className={`flex items-center rounded-full border border-line-10 bg-wash-4 font-medium tracking-[0.14em] uppercase ${
                vp.compact ? 'gap-2 py-1 pr-3 pl-2.5 text-[10px]' : 'gap-2.5 py-1.5 pr-4 pl-3 text-[12px]'
              }`}
            >
              <span className="relative flex size-2">
                <span
                  className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${
                    stale ? 'bg-degraded' : 'animate-ping bg-up'
                  }`}
                />
                <span className={`relative inline-flex size-2 rounded-full ${stale ? 'bg-degraded' : 'bg-up'}`} />
              </span>
              <span className={stale ? 'text-degraded' : 'text-ink-85'}>{stale ? 'Reconnecting' : 'Live'}</span>
            </span>
          )}
        </motion.div>
      </header>

      <main
        className={
          vp.stacked
            ? 'relative z-10 flex flex-col gap-4 pt-2 pb-8'
            : `relative z-10 flex min-h-0 flex-1 ${vp.compact ? 'gap-6 px-6 pt-2 pb-5' : 'gap-10 px-12 pt-4 pb-9'}`
        }
      >
        {/* On a phone the map is the demo, so it runs edge to edge and stays
            in view while the numbers scroll under it. */}
        <section
          className={
            vp.stacked
              ? 'sticky top-0 z-20 flex flex-col bg-page pb-1'
              : 'flex min-w-0 flex-1 flex-col'
          }
        >
          <div
            ref={mapArea}
            data-map-area
            className={`relative flex items-center justify-center overflow-hidden ${
              // Clipped either way: stacked, so a label at the edge cannot
              // widen the page; beside the panel, so an Instance fanned out of
              // a close-up cannot drift across the numbers.
              vp.stacked ? 'w-full' : 'min-h-0 flex-1'
            }`}
            style={vp.stacked ? { height: stackedMapHeight(vp, mapAspect) } : undefined}
          >
            {mapSize.width > 0 && (
              <MeshMap
                width={mapSize.width}
                height={mapSize.height}
                compact={vp.compact}
                reducedMotion={reducedMotion}
                regions={regions}
                links={links}
                intraLinks={intraLinks}
                focus={focus}
                flashing={feed.flashing}
                selected={selected}
                receivedAt={receivedAt}
                onHover={vp.compact ? noop : setHovered}
                onSelect={setSelected}
                onEngage={setSteering}
              />
            )}
            <AnimatePresence>
              {(view?.notice || !view) && (
                <motion.div
                  className="absolute top-1/2 left-1/2 max-w-[90%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line-10 bg-page/80 px-5 py-2.5 text-center text-[14px] text-ink-70"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {view?.notice ?? 'Looking for the rest of the fleet…'}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div
            className={
              vp.stacked ? `${stackedColumn(vp)} pt-1` : `border-t border-line-7 ${vp.compact ? 'pt-4' : 'pt-6'}`
            }
          >
            <div className={`flex items-center ${vp.compact ? 'gap-3' : 'gap-6'}`}>
              <div className={`min-w-0 flex-1 ${vp.compact ? 'min-h-[38px]' : 'min-h-[56px]'}`}>
                <Narrative
                  staticDiscovery={view?.discovery === 'static'}
                  compact={vp.compact}
                  short={vp.mode === 'phone' || vp.mode === 'landscape'}
                  paused={reducedMotion}
                />
              </div>
            </div>
          </div>
          {/* Softens the seam where cards scroll under the pinned map. */}
          {vp.stacked && (
            <div className="pointer-events-none absolute inset-x-0 top-full h-4 bg-gradient-to-b from-page to-transparent" />
          )}
        </section>

        <AnimatePresence>
          {vp.compact && selectedRegion && (
            <div className={vp.stacked ? stackedColumn(vp) : ''}>
              <InstanceCard
                key={selectedRegion.location}
                region={selectedRegion}
                variant="inline"
                compact
                receivedAt={receivedAt}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </AnimatePresence>

        <motion.aside
          data-panel
          className={
            vp.stacked
              ? `w-full ${stackedColumn(vp)}`
              : // Beside the map the panel is as tall as the window, which on a
                // short one is not as tall as its own contents.
                `shrink-0 overflow-y-auto overscroll-contain ${
                  vp.mode === 'landscape'
                    ? 'w-[300px] pr-1 [mask-image:linear-gradient(to_bottom,#000_92%,transparent)]'
                    : 'w-[420px]'
                }`
          }
          initial={{ opacity: 0, x: vp.stacked ? 0 : 16, y: vp.stacked ? 12 : 0 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          transition={{ duration: 0.9, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        >
          <StatsPanel
            view={view}
            regions={regions}
            links={links}
            feed={feed}
            servedAt={servedAt}
            // Where the feeds have a column with a height they fill it and
            // these are ignored. Down a scrolling page there is nothing to
            // measure, so they follow the window instead: a tall page carries
            // more of the feed than a phone without either of them scrolling
            // inside itself.
            feedLimit={rowsFor(vp.height, 170, 5, 9)}
            activityLimit={vp.mode === 'landscape' ? 3 : rowsFor(vp.height, 260, 4, 6)}
            reducedMotion={reducedMotion}
            compact={vp.compact}
            stacked={vp.stacked || vp.mode === 'landscape'}
            columns={vp.stacked ? vp.columns : 1}
          />
        </motion.aside>
      </main>

    </div>
  );
}

function noop() {}

/** Rows a list carries down a page of this height, held between two limits. */
function rowsFor(height: number, per: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(height / per)));
}

/**
 * The content column under a stacked map. The map runs edge to edge because it
 * is the hero; what follows is held to as many reading columns as the window
 * holds. One is a measure a phone and a tablet read at, and stretching it any
 * wider would only put air between a label and its figure. Two grow with the
 * window, because a row of tiles beside two lists goes on reading much wider
 * than a paragraph does.
 */
function stackedColumn(vp: Viewport): string {
  return `mx-auto w-full px-5 ${vp.columns === 2 ? 'max-w-[1280px]' : 'max-w-[760px]'}`;
}

/**
 * How tall the map is when it sits above the panel. A fleet spread around the
 * world is wide and short, so the height follows its shape: forcing it taller
 * would only add empty ocean. The map runs the full width of the screen to
 * win back what that costs.
 *
 * A window wide enough for two columns of content gives the map a little less
 * of itself. The map is that much wider there, so it loses nothing, and what
 * it gives up goes to the two feeds under it.
 */
function stackedMapHeight(vp: Viewport, aspect: number): number {
  const share = vp.columns === 2 ? 0.42 : vp.mode === 'tablet' ? 0.46 : 0.44;
  return Math.round(Math.max(200, Math.min(vp.width / aspect, vp.height * share)));
}

/** Cycles the spotlight through regions, starting where the page was served. */
function useTour(locations: string[], selfLocation: string | null, paused: boolean): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  const resumeAt = useRef(0);
  const key = locations.join(',');

  useEffect(() => {
    if (paused) resumeAt.current = Date.now() + IDLE_RESUME_MS;
  }, [paused]);

  useEffect(() => {
    if (locations.length === 0) {
      setCurrent(null);
      return;
    }
    setCurrent((c) => (c && locations.includes(c) ? c : (selfLocation ?? locations[0])));
    const id = window.setInterval(() => {
      if (Date.now() < resumeAt.current) return;
      setCurrent((c) => {
        const order = selfLocation ? [selfLocation, ...locations.filter((l) => l !== selfLocation)] : locations;
        const i = c ? order.indexOf(c) : -1;
        return order[(i + 1) % order.length];
      });
    }, TOUR_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, selfLocation]);

  return current;
}

/**
 * The size the map should draw at. Either way it fills the box it is given and
 * the camera crops to suit; what differs is how that box is bounded. Stacked,
 * the height follows the fleet's own shape. Beside the panel the map takes the
 * column, capped so it can never sit in a box squarer than the fleet: fitting
 * the whole world's proportions inside a tall column instead is what left
 * bands of empty ocean above and below it.
 */
function useMapSize(ref: React.RefObject<HTMLDivElement | null>, vp: Viewport): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width: w, height: h } = el.getBoundingClientRect();
      if (w <= 0 || h <= 0) return;
      if (vp.stacked) {
        setSize({ width: Math.floor(w), height: Math.floor(h) });
        return;
      }
      setSize({ width: Math.floor(w), height: Math.floor(Math.min(h, w / MIN_MAP_ASPECT)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, vp.stacked]);
  return size;
}

function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0">
      <div className="absolute inset-0 [background-image:var(--backdrop-wash)]" />
      <div className="absolute -top-40 left-1/3 h-[480px] w-[900px] rounded-full bg-moss/[0.035] blur-[120px]" />
      <div className="absolute inset-0 [background-image:var(--backdrop-vignette)]" />
    </div>
  );
}

/** Closes the open card on a tap anywhere else, or on Escape. */
function useDismissOnOutside(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('[data-instance-card]') || target?.closest('[data-pin]')) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
}
