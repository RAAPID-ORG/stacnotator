import { fromLonLat } from 'ol/proj';
import { createXYZ } from 'ol/tilegrid';
import { useEffect, useRef, useState } from 'react';
import type { ImageryCollectionOut } from '~/api/client';
import {
  emptyKey,
  sliceRaster,
  type Catalog,
  type Empties,
  type SliceAddress,
} from '../../domain/catalog';
import { addressAtSlice, sliceNavIndices } from '../../domain/imageryNav';
import { ensureTilerSession } from '~/api/tilerToken';
import type { LonLat } from '../../map/types';

export interface ProbeCandidate {
  index: number;
  label: string;
}

export type ProbePhase = 'idle' | 'searching' | 'found' | 'no-data';

export interface ProbeState {
  phase: ProbePhase;
  /** Remaining candidates still to probe; the head is the one in flight. */
  queue: ProbeCandidate[];
  /** Slice indices confirmed empty so far this run, for a single markEmpty batch. */
  emptyIndices: number[];
  resolvedIndex: number | null;
}

export const IDLE_PROBE: ProbeState = {
  phase: 'idle',
  queue: [],
  emptyIndices: [],
  resolvedIndex: null,
};

/** Seeds a search after the current slice has already been probed and found
 *  empty: `currentIndex` is folded into `emptyIndices` up front since it was
 *  checked outside the reducer (a single, unconditional pre-check the way
 *  reducer or shows a "searching" state at all). */
export function startProbe(currentIndex: number, candidates: ProbeCandidate[]): ProbeState {
  if (candidates.length === 0) {
    return { phase: 'no-data', queue: [], emptyIndices: [currentIndex], resolvedIndex: null };
  }
  return {
    phase: 'searching',
    queue: candidates,
    emptyIndices: [currentIndex],
    resolvedIndex: null,
  };
}

/** Folds one probe outcome (`empty`, for the queue's current head) into the
 *  next state: a hit commits, a miss advances to the next candidate, and
 *  running out commits to 'no-data'. A no-op outside 'searching' so a late
 *  result from an aborted run cannot resurrect it. */
export function nextProbe(state: ProbeState, empty: boolean): ProbeState {
  if (state.phase !== 'searching' || state.queue.length === 0) return state;
  const [current, ...rest] = state.queue;
  if (!empty) {
    return {
      phase: 'found',
      queue: rest,
      emptyIndices: state.emptyIndices,
      resolvedIndex: current.index,
    };
  }
  const emptyIndices = [...state.emptyIndices, current.index];
  return rest.length === 0
    ? { phase: 'no-data', queue: [], emptyIndices, resolvedIndex: null }
    : { phase: 'searching', queue: rest, emptyIndices, resolvedIndex: null };
}

/** Search order: forward from the current slice (stay within the time
 *  series), then backward, then any remaining slice (e.g. a custom cover) as
 *  a last resort. Already-known-empty slices are skipped via
 *  `sliceNavIndices`'s `empties` filter, matching stepSlice/stepCollection's
 *  own candidate set. */
export function candidateOrder(
  collection: ImageryCollectionOut,
  empties: Empties,
  currentIndex: number
): number[] {
  const nav = sliceNavIndices(collection, empties);
  const navSet = new Set(nav);
  const forward = nav.filter((i) => i > currentIndex);
  const backward = [...nav].reverse().filter((i) => i < currentIndex);
  // rest = structurally-excluded slices only (a dedicated cover); a slice
  // already known empty is skipped entirely rather than retried last.
  const rest = collection.slices
    .map((_, i) => i)
    .filter((i) => i !== currentIndex && !navSet.has(i) && !empties[emptyKey(collection.id, i)]);
  return [...forward, ...backward, ...rest];
}

function candidateLabel(collection: ImageryCollectionOut, index: number): string {
  return collection.slices[index]?.name || `Slice ${index + 1}`;
}

/**
 * A window probes its own camera's center, which is only trustworthy while
 * that camera is actually tracking the main one. A
 * background window that is neither following nor active can sit wherever it
 * was last panned, and probing there would markEmpty a slice for a location
 * nobody is looking at, poisoning the empties record every other map reads.
 */
export function shouldHeal(viewSync: boolean, isActive: boolean): boolean {
  return viewSync || isActive;
}

export interface HealingGate {
  viewSync: boolean;
  isActive: boolean;
  /** The slice this window is currently showing. */
  sliceIndex: number | null;
  /** The slice the user last chose by hand for this window, if any. */
  userPickedIndex: number | null;
}

/**
 * Whether this window's healing may run at all.
 *
 * On top of `shouldHeal`'s "is this window tracking the main camera", a slice
 * the user picked by hand is off limits: healing would find it empty, record
 * that, and swap the window onto a different one - which reads as the picker
 * refusing the choice that was just made. The suppression is not sticky; it
 * lapses as soon as the window is addressed at some other slice, i.e. as soon
 * as navigation moves it off the pick.
 */
export function healingEnabled(gate: HealingGate): boolean {
  if (!shouldHeal(gate.viewSync, gate.isActive)) return false;
  return gate.sliceIndex === null || gate.userPickedIndex !== gate.sliceIndex;
}

export interface UseEmptyHealingArgs {
  catalog: Catalog;
  collection: ImageryCollectionOut;
  /** The window's own current address, or null while it has none to show. */
  address: SliceAddress | null;
  /** Gate from `shouldHeal`: false leaves this window's probe idle. */
  enabled: boolean;
  /** Reference point to probe, read at effect time (not render time) so a
   *  follower camera that just snapped is probed at its real position. */
  getPoint: () => LonLat | null;
  zoom: number;
  empties: Empties;
  markEmpty: (collectionId: number, sliceIndex: number) => void;
  /** Called once with the winning slice index when healing finds one. */
  onResolved: (sliceIndex: number) => void;
}

export interface EmptyHealingResult {
  /** Set while actively searching; the candidate currently being probed. */
  searchingLabel: string | null;
  /** Set once every candidate came back empty. */
  noImagery: boolean;
}

interface TileTarget {
  url: string;
  credentialed: boolean;
}

/** Same default XYZ grid the preloader's `tileUrlsForExtent` is built from -
 *  shared here only for its single-point lookup, `getTileCoordForCoordAndZ`.
 *  A bbox-range lookup (tileUrlsForExtent) returns nothing for a zero-area
 *  point extent, which a probe always is; asking the grid for the one tile
 *  under a coordinate is both the correct primitive for that and avoids an
 *  arbitrary epsilon-sized bbox that could straddle a tile boundary. */
const tileGrid = createXYZ();

function tileTargetFor(
  catalog: Catalog,
  address: SliceAddress,
  sliceIndex: number,
  point: LonLat,
  zoom: number
): TileTarget | null {
  let spec;
  try {
    spec = sliceRaster(catalog, addressAtSlice(catalog, address, sliceIndex));
  } catch {
    return null;
  }
  const tileCoord = tileGrid.getTileCoordForCoordAndZ(fromLonLat(point), Math.round(zoom));
  if (!tileCoord) return null;
  const [z, x, y] = tileCoord;
  const url = spec.url
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y));
  return { url, credentialed: spec.auth === 'cookie' };
}

/** Resolves true when the tile is empty (no content / not found). Our tilers
 *  answer 204 for an empty tile; credentialed sources authenticate via the
 *  tiler cookie, refreshed first. */
async function probeEmpty(target: TileTarget, signal: AbortSignal): Promise<boolean> {
  if (target.credentialed) await ensureTilerSession();
  const resp = await fetch(target.url, {
    mode: 'cors',
    credentials: target.credentialed ? 'include' : 'omit',
    signal,
  });
  if (resp.status === 204) return true;
  if (resp.ok) return false;
  // A generic failure says nothing about spatial coverage. Leave the current
  // selection alone and retry on the next location/address change.
  throw new Error(`Imagery probe failed with HTTP ${resp.status}`);
}

export function useEmptyHealing(args: UseEmptyHealingArgs): EmptyHealingResult {
  const { catalog, collection, address, enabled, getPoint, zoom, empties, markEmpty, onResolved } =
    args;
  const [state, setState] = useState<ProbeState>(IDLE_PROBE);

  const markEmptyRef = useRef(markEmpty);
  markEmptyRef.current = markEmpty;
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  const getPointRef = useRef(getPoint);
  getPointRef.current = getPoint;

  useEffect(() => {
    setState(IDLE_PROBE);
    if (!enabled || !address) return;
    const point = getPointRef.current();
    if (!point) return;

    const controller = new AbortController();

    (async () => {
      const current = tileTargetFor(catalog, address, address.sliceIndex, point, zoom);
      if (!current) return;
      const currentlyEmpty = await probeEmpty(current, controller.signal);
      if (controller.signal.aborted || !currentlyEmpty) return;

      const order = candidateOrder(collection, empties, address.sliceIndex);
      const candidates = order.map((i) => ({ index: i, label: candidateLabel(collection, i) }));
      let probe = startProbe(address.sliceIndex, candidates);
      setState(probe);

      while (probe.phase === 'searching' && !controller.signal.aborted) {
        const head = probe.queue[0];
        const target = tileTargetFor(catalog, address, head.index, point, zoom);
        const empty = target ? await probeEmpty(target, controller.signal) : true;
        if (controller.signal.aborted) return;
        probe = nextProbe(probe, empty);
        setState(probe);
      }

      for (const i of probe.emptyIndices) markEmptyRef.current(address.collectionId, i);
      if (probe.phase === 'found' && probe.resolvedIndex != null)
        onResolvedRef.current(probe.resolvedIndex);
    })().catch(() => {
      // aborted or network error - the next address/point change tries again
    });

    return () => controller.abort();
    // address is read through the closure above rather than listed whole:
    // windowAddress() rebuilds a fresh object every render for a non-active
    // window, and keying on it would re-probe every render instead of only
    // when the slice actually addressed changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    catalog,
    collection,
    address?.collectionId,
    address?.sliceIndex,
    address?.sourceId,
    address?.vizId,
    enabled,
    empties,
    zoom,
  ]);

  return {
    searchingLabel: state.phase === 'searching' ? (state.queue[0]?.label ?? null) : null,
    noImagery: state.phase === 'no-data',
  };
}
