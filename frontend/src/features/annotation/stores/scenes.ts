import { useCallback, useEffect, useMemo } from 'react';
import { create } from 'zustand';
import {
  mintPlanetSceneLayers,
  searchPlanetScenes,
  type ImagerySourceOut,
  type PlanetSceneSliceOut,
} from '~/api/client';
import { useCameraValue } from '~/shared/map/Camera';
import { setForegroundMapLoading } from '~/shared/map/tileLoading';
import type { Bbox, CameraSnapshot } from '~/shared/map/types';
import { handleError } from '~/shared/utils/errorHandler';
import {
  MIN_SCENE_ZOOM,
  boxAround,
  covers,
  searchBox,
  sceneSourcesInView,
  shownSceneSource,
} from '../campaign/scenes';
import type { ImageryCollectionOut } from '~/api/client';
import type { ImageryCatalog } from '../campaign/imagery';
import { sliceNavIndices, type Empties } from '../campaign/imageryNav';
import { mainCamera } from '../map/camera';
import { useCampaignStore, useCatalog } from './campaign';
import { useImageryStore } from './imagery';
import { useMapFocus } from './tasks';

/**
 * Planet's archive over where the annotator is standing.
 *
 * Searching is expensive on Planet's side - one request per configured date, paced so
 * we are not rate limited - so every search goes through here: results are kept for
 * the page's lifetime and reused wherever they still cover the screen, one search runs
 * at a time, and the search the user is waiting for takes the connection off whichever
 * speculative one is holding it.
 */

interface ScenesState {
  /** What each source's drawn layers cover, so a pan can tell it has left them. */
  loaded: Record<number, Bbox>;
  /** Sources being searched for the view the user is looking at now. */
  loading: Record<number, boolean>;
  /** Sources with a tile layer on its way for a date being opened. */
  minting: Record<number, boolean>;
}

export const useScenesStore = create<ScenesState>(() => ({
  loaded: {},
  loading: {},
  minting: {},
}));

interface Found {
  sourceId: number;
  box: Bbox;
  /** Every date this extent holds imagery for. ``layer_id`` fills in as the layers
   *  are minted, so a view that was searched ahead of time arrives already drawable. */
  slices: PlanetSceneSliceOut[];
  /** Dates whose layer has been asked for, so nothing is asked for twice. */
  asked: Set<number>;
}

/** A few tasks' worth, which is what the prefetch below can be ahead by. */
const CACHE_LIMIT = 12;
let cache: Found[] = [];

interface Job {
  source: ImagerySourceOut;
  campaignId: number;
  box: Bbox;
  /** Draw the result when it lands, rather than only remembering it. */
  show: boolean;
}

let queue: Job[] = [];
let running: { job: Job; abort: AbortController } | null = null;
/** Bumped by a reset, so a search still in the air when the campaign changes cannot
 *  come back and write into the one that replaced it. */
let epoch = 0;

const sameBox = (a: Bbox, b: Bbox) => a.every((value, i) => value === b[i]);
const sameJob = (a: Job, b: Job) => a.source.id === b.source.id && sameBox(a.box, b.box);

/** Everything this page found, dropped with the campaign it belongs to. */
export function resetScenes(): void {
  epoch += 1;
  cache = [];
  queue = [];
  running?.abort.abort();
  running = null;
  urgentQueue = [];
  fillQueue = [];
  mintRunning.urgent?.abort.abort();
  mintRunning.fill?.abort.abort();
  mintRunning.urgent = null;
  mintRunning.fill = null;
  setForegroundMapLoading('scenes', false);
  useScenesStore.setState({ loaded: {}, loading: {}, minting: {} });
}

/** Forget speculative work that has not started: once the annotator has moved on, the
 *  views it was for are no longer the ones coming up. Whatever is still wanted is
 *  queued again by the caller, and matches what is already running or cached. */
export function forgetSpeculative(): void {
  queue = queue.filter((job) => job.show);
  // Same for the layers: filling in the dates of a view that is no longer coming up
  // would spend the rate limit the view in front of the annotator needs. The ones
  // still wanted are asked for again by the caller, off what the search already found.
  fillQueue = [];
}

/**
 * Have `source` cover `view`, drawing it if `show`.
 *
 * The only entry point, so nothing searches past what is already known: a previous
 * search that reached wider than this view answers it without a request.
 */
export function wantScenes(
  source: ImagerySourceOut,
  campaignId: number,
  view: Bbox,
  show: boolean
): void {
  const known = cache.find((found) => found.sourceId === source.id && covers(found.box, view));
  if (known) {
    if (show) draw(source, campaignId, known);
    fill(known, source, campaignId);
    return;
  }

  const job: Job = { source, campaignId, box: searchBox(view), show };
  if (running && sameJob(running.job, job)) {
    running.job.show = running.job.show || show;
    return;
  }
  const queued = queue.find((other) => sameJob(other, job));
  if (queued) {
    queued.show = queued.show || show;
    if (show) queue = [queued, ...queue.filter((other) => other !== queued)];
    return;
  }

  if (show) {
    queue.unshift(job);
    // A search someone is watching cannot sit behind a speculative one that still has
    // ten dates to go. The speculative one goes back on the queue and starts over.
    if (running && !running.job.show) running.abort.abort();
  } else {
    queue.push(job);
  }
  pump();
}

function pump(): void {
  if (running || queue.length === 0) return;
  const job = queue.shift()!;
  const era = epoch;
  const abort = new AbortController();
  running = { job, abort };
  setLoading(job.source.id, job.show);
  publishSceneUrgency();

  void searchPlanetScenes({
    path: { campaign_id: job.campaignId, source_id: job.source.id },
    body: { bbox: job.box },
    signal: abort.signal,
    throwOnError: true,
  })
    .then(({ data }) => {
      if (era !== epoch) return;
      const found: Found = {
        sourceId: job.source.id,
        box: job.box,
        slices: data.slices,
        asked: new Set(),
      };
      cache = [found, ...cache].slice(0, CACHE_LIMIT);
      if (job.show) draw(job.source, job.campaignId, found);
      fill(found, job.source, job.campaignId);
      if (!job.show) return;
      // Planet refusing one date still leaves the others usable, so this reports
      // rather than throws away what came back.
      for (const message of data.errors ?? []) handleError(new Error(message), message);
    })
    .catch((error: unknown) => {
      if (era !== epoch) return;
      if (abort.signal.aborted) queue.push(job);
      else if (job.show) handleError(error, 'Could not load Planet imagery for this viewport');
    })
    .finally(() => {
      if (era !== epoch) return;
      running = null;
      setLoading(job.source.id, false);
      publishSceneUrgency();
      pump();
    });
}

/**
 * Whether the annotator is waiting on Planet right now: a search they can see, or the
 * layer for a date they have opened.
 *
 * Published where the tile preloader reads it, so speculation stands aside. Both spend
 * the same six connections the browser gives this origin, and a mint stuck behind
 * fifty speculative tiles is thirty seconds of a blank date.
 */
function publishSceneUrgency(): void {
  setForegroundMapLoading('scenes', Boolean(running?.job.show || mintRunning.urgent));
}

function setLoading(sourceId: number, loading: boolean): void {
  useScenesStore.setState((state) => ({ loading: { ...state.loading, [sourceId]: loading } }));
}

function draw(source: ImagerySourceOut, campaignId: number, found: Found): void {
  const vizName = source.visualizations[0]?.name;
  const { catalog, applySceneSearch } = useCampaignStore.getState();
  if (!vizName || catalog?.campaignId !== campaignId) return;
  // Already on screen. Drawing it again would rebuild the catalog into an equal but
  // new object, and everything that watches the catalog - this store's own auto-load
  // among them - would come straight back here.
  const shown = useScenesStore.getState().loaded[source.id];
  if (shown && sameBox(shown, found.box)) return;
  // What is on screen is filled in before anything that was searched ahead.
  fillQueue = [
    ...fillQueue.filter((job) => job.found === found),
    ...fillQueue.filter((job) => job.found !== found),
  ];
  applySceneSearch(source.id, vizName, found.slices);
  useScenesStore.setState((state) => ({ loaded: { ...state.loaded, [source.id]: found.box } }));
}

// ---------------------------------------------------------------------------
// Tile layers for the dates that were found
// ---------------------------------------------------------------------------

interface MintJob {
  found: Found;
  source: ImagerySourceOut;
  campaignId: number;
  sliceIds: number[];
}

/** The date on screen and its neighbours, ahead of the steady fill behind them. */
let urgentQueue: MintJob[] = [];
let fillQueue: MintJob[] = [];
/** Two lanes, one request each: the fill works through the dates nobody has opened
 *  yet, and a date someone opens is never behind it. More than that would only be a
 *  second way to queue - the pace Planet allows is kept on the server. */
const mintRunning: { urgent: Running | null; fill: Running | null } = {
  urgent: null,
  fill: null,
};

interface Running {
  job: MintJob;
  abort: AbortController;
}

/** Dates per request. One search covers the batch and its layers are minted together,
 *  so a bigger batch is cheaper per date - bounded by the endpoint's own limit of 64,
 *  and by a batch still being short enough for an opened date to overtake. */
const MINT_BATCH = 24;

/**
 * Have `sliceIds` drawable now: the date on screen, and the next ones along.
 *
 * Asked for on its own and sent at once - it does not wait behind the fill, and it
 * carries only these dates even when the fill had already queued them in a batch of
 * twenty-four. Opening a date is the one thing here somebody is watching.
 */
export function wantSliceLayers(
  source: ImagerySourceOut,
  campaignId: number,
  sliceIds: number[]
): void {
  const box = useScenesStore.getState().loaded[source.id];
  const found = box && cache.find((f) => f.sourceId === source.id && sameBox(f.box, box));
  if (!found) return;

  // Taken out of whatever the fill was going to ask for them in, so they are not
  // minted twice and the batch left behind still carries the rest.
  const wanted = new Set(sliceIds);
  fillQueue = fillQueue.flatMap((job) => {
    if (job.found !== found) return [job];
    const rest = job.sliceIds.filter((id) => !wanted.has(id));
    if (rest.length === job.sliceIds.length) return [job];
    // Re-asked below, as part of the urgent job.
    for (const id of job.sliceIds) if (wanted.has(id)) found.asked.delete(id);
    return rest.length > 0 ? [{ ...job, sliceIds: rest }] : [];
  });

  const job = mintJob(found, source, campaignId, sliceIds);
  if (!job) return;
  urgentQueue.push(job);
  pumpMint();
}

/**
 * Mint every date this view found, a batch at a time.
 *
 * What makes a task that was searched ahead of time arrive complete rather than
 * cover-only: the fill runs behind whatever the annotator is opening, and is dropped
 * for views that are no longer coming up (`forgetSpeculative`).
 */
function fill(found: Found, source: ImagerySourceOut, campaignId: number): void {
  const rest = found.slices.filter((slice) => !slice.layer_id).map((slice) => slice.slice_id);
  for (let i = 0; i < rest.length; i += MINT_BATCH) {
    const job = mintJob(found, source, campaignId, rest.slice(i, i + MINT_BATCH));
    if (job) fillQueue.push(job);
  }
  pumpMint();
}

/** The dates of `sliceIds` still worth asking for, as one request, or null. */
function mintJob(
  found: Found,
  source: ImagerySourceOut,
  campaignId: number,
  sliceIds: number[]
): MintJob | null {
  const wanted = sliceIds
    .filter((id) => !found.asked.has(id))
    .filter((id) => found.slices.some((slice) => slice.slice_id === id && !slice.layer_id))
    .slice(0, MINT_BATCH);
  if (wanted.length === 0) return null;
  for (const id of wanted) found.asked.add(id);
  return { found, source, campaignId, sliceIds: wanted };
}

function pumpMint(): void {
  if (!mintRunning.urgent && urgentQueue.length > 0) runMint(urgentQueue.shift()!, true);
  if (!mintRunning.fill && fillQueue.length > 0) runMint(fillQueue.shift()!, false);
}

function runMint(job: MintJob, urgent: boolean): void {
  const era = epoch;
  const abort = new AbortController();
  const lane = urgent ? 'urgent' : 'fill';
  mintRunning[lane] = { job, abort };
  // Only what someone is waiting for is worth saying out loud; the fill runs for a
  // minute at a time and is nobody's cue to wait.
  if (urgent) {
    setMinting(job.source.id, true);
    publishSceneUrgency();
  }

  void mintPlanetSceneLayers({
    path: { campaign_id: job.campaignId, source_id: job.source.id },
    body: { bbox: job.found.box, slice_ids: job.sliceIds },
    signal: abort.signal,
    throwOnError: true,
  })
    .then(({ data }) => {
      if (era !== epoch) return;
      const layers = new Map(data.slices.map((slice) => [slice.slice_id, slice.layer_id]));
      job.found.slices = job.found.slices.map((slice) =>
        layers.has(slice.slice_id)
          ? { ...slice, layer_id: layers.get(slice.slice_id) ?? null }
          : slice
      );
      const vizName = job.source.visualizations[0]?.name;
      const { catalog, applySceneLayers } = useCampaignStore.getState();
      // Only into the place these layers are of: a view searched ahead of time keeps
      // them until it is the one being looked at.
      if (!vizName || catalog?.campaignId !== job.campaignId || !isDrawn(job.found)) return;
      applySceneLayers(job.source.id, vizName, data.slices);
      for (const message of data.errors ?? []) handleError(new Error(message), message);
    })
    .catch((error: unknown) => {
      if (era !== epoch || abort.signal.aborted) return;
      // Asked for again on the next step rather than left permanently unminted.
      for (const id of job.sliceIds) job.found.asked.delete(id);
      handleError(error, 'Could not load Planet imagery for this date', { showUser: urgent });
    })
    .finally(() => {
      mintRunning[lane] = null;
      if (era !== epoch) return;
      if (urgent) {
        setMinting(
          job.source.id,
          urgentQueue.some((next) => next.source.id === job.source.id)
        );
        publishSceneUrgency();
      }
      pumpMint();
    });
}

/** Whether these layers are of the extent this source is currently drawn over. */
function isDrawn(found: Found): boolean {
  const shown = useScenesStore.getState().loaded[found.sourceId];
  return !!shown && sameBox(shown, found.box);
}

function setMinting(sourceId: number, minting: boolean): void {
  useScenesStore.setState((state) => ({ minting: { ...state.minting, [sourceId]: minting } }));
}

// ---------------------------------------------------------------------------
// What the page asks for
// ---------------------------------------------------------------------------

/** Load what is on screen now, from the control the user pressed. */
export function loadScenesHere(sources: ImagerySourceOut[], campaignId: number): void {
  const view = mainCamera.getBounds();
  for (const source of sources) wantScenes(source, campaignId, view, true);
}

/** Scene sources the page is browsing, scene ones only. */
export function useSceneSourcesInView(): ImagerySourceOut[] {
  const catalog = useCatalog();
  const view = useCampaignStore((state) => state.view);
  return useMemo(() => sceneSourcesInView(catalog, view), [catalog, view]);
}

/** The scene source the main map is showing, if that is what it is showing. */
export function useShownSceneSource(): ImagerySourceOut | null {
  const catalog = useCatalog();
  const sourceId = useImageryStore((state) => state.address?.sourceId ?? null);
  return useMemo(() => shownSceneSource(catalog, sourceId), [catalog, sourceId]);
}

/** Whether `source` has nothing drawn over what is on screen - after a pan past the
 *  edge of the last search, or before the first one. A boolean rather than the
 *  camera's bounds, so panning inside what is loaded re-renders nothing. */
export function useScenesUncovered(source: ImagerySourceOut | null): boolean {
  const loaded = useScenesStore((state) => state.loaded);
  const uncovered = useCallback(
    ({ bounds }: CameraSnapshot) => {
      if (!source) return false;
      const box = loaded[source.id];
      return !box || !covers(box, bounds);
    },
    [source, loaded]
  );
  return useCameraValue(mainCamera, uncovered);
}

/** Whether the screen is small enough to be worth searching. */
export function useScenesLoadable(): boolean {
  return useCameraValue(mainCamera, loadableZoom);
}

const loadableZoom = ({ zoom }: CameraSnapshot) => zoom >= MIN_SCENE_ZOOM;

export function useScenesLoading(): boolean {
  return useScenesStore((state) => Object.values(state.loading).some(Boolean));
}

/** Whether a date's own tile layer is on its way. Separate from the search: the map
 *  already has the rest of the window, and this is one date filling in. */
export function useSceneDateLoading(): boolean {
  return useScenesStore((state) => Object.values(state.minting).some(Boolean));
}

/**
 * Keep the task the annotator is on, and the next few, searched.
 *
 * Landing on a task and being made to press a button first is the same wait as
 * searching on arrival, so tasks search themselves - and because the task list says
 * where the annotator goes next, the ones after it are searched while this one is
 * being worked on, arriving before anyone looks at them. Explore has no such list:
 * there the load is the user's own.
 */
export function useSceneAutoLoad(): void {
  const catalog = useCatalog();
  const view = useCampaignStore((state) => state.view);
  const mode = useCampaignStore((state) => state.workMode);
  const focus = useMapFocus();
  const sources = sceneSourcesInView(catalog, view);
  // The catalog is rebuilt by every draw, so the effect is tied to what it actually
  // reads - which campaign, and which sources - rather than to that identity.
  const { campaignId } = catalog;
  const sourceKey = sources.map((source) => source.id).join(',');

  useEffect(() => {
    if (mode !== 'tasks' || !focus || sources.length === 0) return;

    // The task the map is about to move to, at the scale it is about to use: the box
    // comes from where the task is and how much screen there is, not from where the
    // map currently points.
    const attempt = (): boolean => {
      if (mainCamera.getState().zoom < MIN_SCENE_ZOOM) return false;
      const screen = mainCamera.getBounds();
      forgetSpeculative();
      for (const source of sources) {
        wantScenes(source, campaignId, boxAround(focus.center, screen), true);
        for (const next of focus.upcoming) {
          wantScenes(source, campaignId, boxAround(next, screen), false);
        }
      }
      return true;
    };

    if (attempt()) return;
    // Opening the page puts the camera on the campaign before it puts it on the task,
    // so the first task is reached a moment after its focus is published.
    let stop: (() => void) | null = null;
    stop = mainCamera.onChange(() => {
      if (attempt()) stop?.();
    });
    return () => stop?.();
    // sourceKey stands in for the source list, rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, sourceKey, mode, focus]);
}

/** How far ahead of the date on screen the layers are minted. Forward-weighted:
 *  stepping through a window is a walk in one direction. */
const LOOKAHEAD = 2;
const LOOKBEHIND = 1;

/**
 * Mint the layer for every date on screen, and for the next ones along.
 *
 * The dates a search found are navigable straight away; this is what makes them
 * drawable, one small request at a time, so opening a window is not behind hundreds of
 * mints for dates nobody asked for.
 */
export function useSceneSliceLayers(): void {
  const catalog = useCatalog();
  const view = useCampaignStore((state) => state.view);
  const address = useImageryStore((state) => state.address);
  const windowSlices = useImageryStore((state) => state.windowSlices);
  const empties = useImageryStore((state) => state.empties);
  const loaded = useScenesStore((state) => state.loaded);

  useEffect(() => {
    for (const source of sceneSourcesInView(catalog, view)) {
      if (!loaded[source.id]) continue;
      const wanted = new Set<number>();
      for (const collection of source.collections) {
        const shown =
          address?.collectionId === collection.id
            ? address.sliceIndex
            : windowSlices[collection.id]?.selected;
        if (shown === undefined) continue;
        for (const index of aroundSlice(catalog, collection, empties, shown)) {
          const slice = collection.slices[index];
          if (slice) wanted.add(slice.id);
        }
      }
      if (wanted.size > 0) wantSliceLayers(source, catalog.campaignId, [...wanted]);
    }
  }, [catalog, view, address, windowSlices, empties, loaded]);
}

/** The date being shown and its neighbours, in the order they are worth having. */
function aroundSlice(
  catalog: ImageryCatalog,
  collection: ImageryCollectionOut,
  empties: Empties,
  index: number
): number[] {
  const nav = sliceNavIndices(catalog, collection, empties);
  const at = nav.findIndex((i) => i >= index);
  if (at === -1) return [index];
  return [
    index,
    ...nav.slice(at + 1, at + 1 + LOOKAHEAD),
    ...nav.slice(Math.max(0, at - LOOKBEHIND), at),
  ];
}
