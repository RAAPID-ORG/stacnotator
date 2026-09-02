import { useCallback, useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { searchPlanetScenes, type ImagerySourceOut, type PlanetSceneSliceOut } from '~/api/client';
import { planetLayerProxyUrl } from '~/shared/imagery/tileUrls';
import { useCameraValue } from '~/shared/map/Camera';
import type { Bbox, CameraSnapshot } from '~/shared/map/types';
import { handleError } from '~/shared/utils/errorHandler';
import {
  MIN_SCENE_ZOOM,
  boxAround,
  covers,
  searchBox,
  sceneSourcesInView,
} from '../campaign/scenes';
import { mainCamera } from '../map/camera';
import { useCampaignStore, useCatalog } from './campaign';
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
}

export const useScenesStore = create<ScenesState>(() => ({ loaded: {}, loading: {} }));

interface Found {
  sourceId: number;
  box: Bbox;
  slices: PlanetSceneSliceOut[];
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
  useScenesStore.setState({ loaded: {}, loading: {} });
}

/** Forget speculative work that has not started: once the annotator has moved on, the
 *  views it was for are no longer the ones coming up. Whatever is still wanted is
 *  queued again by the caller, and matches what is already running or cached. */
export function forgetSpeculative(): void {
  queue = queue.filter((job) => job.show);
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

  void searchPlanetScenes({
    path: { campaign_id: job.campaignId, source_id: job.source.id },
    body: { bbox: job.box },
    signal: abort.signal,
    throwOnError: true,
  })
    .then(({ data }) => {
      if (era !== epoch) return;
      const found: Found = { sourceId: job.source.id, box: job.box, slices: data.slices };
      cache = [found, ...cache].slice(0, CACHE_LIMIT);
      if (!job.show) return;
      draw(job.source, job.campaignId, found);
      // Planet refusing one date still leaves the others usable, so this reports
      // rather than throws away what came back.
      for (const message of data.errors ?? []) handleError(new Error(message), message);
    })
    .catch((error: unknown) => {
      if (era !== epoch) return;
      if (abort.signal.aborted) queue.push(job);
      else if (job.show) handleError(error, 'Could not load Planet imagery for this view');
    })
    .finally(() => {
      if (era !== epoch) return;
      running = null;
      setLoading(job.source.id, false);
      pump();
    });
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
  applySceneSearch(
    source.id,
    vizName,
    new Map(
      found.slices.map((slice) => [
        slice.slice_id,
        planetLayerProxyUrl(campaignId, source.id, slice.layer_id),
      ])
    )
  );
  useScenesStore.setState((state) => ({ loaded: { ...state.loaded, [source.id]: found.box } }));
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

/** Whether any scene source has nothing drawn over what is on screen - after a pan
 *  past the edge of the last search, or before the first one. A boolean rather than
 *  the camera's bounds, so panning inside what is loaded re-renders nothing. */
export function useScenesUncovered(): boolean {
  const sources = useSceneSourcesInView();
  const loaded = useScenesStore((state) => state.loaded);
  const uncovered = useCallback(
    ({ bounds }: CameraSnapshot) =>
      sources.some((source) => {
        const box = loaded[source.id];
        return !box || !covers(box, bounds);
      }),
    [sources, loaded]
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
