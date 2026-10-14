import { useEffect, useRef, useState } from 'react';
import type { MeshView } from './types';

export interface MeshState {
  view: MeshView | null;
  /** performance.now() when the current view arrived. */
  receivedAt: number;
  /** True when the latest poll failed and an older view is shown. */
  stale: boolean;
}

/** A poll that has not answered by now is dropped, so one stuck request cannot stop the page updating. */
const POLL_TIMEOUT_MS = 6000;

/** Polls /api/mesh, keeping the last good view through transient failures. */
export function useMesh(intervalMs = 2000, paused = false): MeshState {
  const [state, setState] = useState<MeshState>({ view: null, receivedAt: 0, stale: false });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const pollNow = useRef<() => void>(() => {});
  const cancelPoll = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let current: AbortController | null = null;
    cancelPoll.current = () => current?.abort();
    const poll = async (force = false) => {
      // A backgrounded tab on a phone should not keep polling.
      if (document.hidden || pausedRef.current) return;
      if (current) {
        if (!force) return;
        current.abort();
      }
      const ac = new AbortController();
      current = ac;
      const timer = window.setTimeout(() => ac.abort(), POLL_TIMEOUT_MS);
      try {
        const res = await fetch('/api/mesh', { cache: 'no-store', signal: ac.signal });
        if (!res.ok) throw new Error(res.statusText);
        const view = (await res.json()) as MeshView;
        if (!cancelled && current === ac && !pausedRef.current) {
          setState({ view, receivedAt: performance.now(), stale: false });
        }
      } catch {
        // Aborted by a pause or by a newer poll: nothing to report. Timed out or failed: keep the old view.
        if (!cancelled && current === ac && !pausedRef.current) setState((s) => ({ ...s, stale: true }));
      } finally {
        window.clearTimeout(timer);
        if (current === ac) current = null;
      }
    };
    pollNow.current = () => void poll(true);
    void poll();
    const id = window.setInterval(() => void poll(), intervalMs);
    // Refresh as soon as the visitor comes back to the page.
    const onVisible = () => {
      if (!document.hidden) void poll(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      current?.abort();
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);

  // Pausing drops any request in flight; resuming starts a fresh one at once rather than at the next tick.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (paused) cancelPoll.current();
    else pollNow.current();
  }, [paused]);

  return state;
}

/** Re-renders on an interval; used for ticking uptimes. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
