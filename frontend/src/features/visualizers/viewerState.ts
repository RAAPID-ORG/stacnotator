import type { VisualizerImageryOut, VisualizerStepOut, VisualizerViewOut } from '~/api/client';
import type { RenderOverride } from '~/shared/imagery/tileColors';
import { basemapLayer, customMapLayer, vectorLayer } from '~/shared/imagery/layerSpecs';
import {
  BASEMAP_STYLE_URL,
  needsKeyProxy,
  sliceProxyUrl,
  tileAuth,
} from '~/shared/imagery/tileUrls';
import { DEFAULT_MAP_ZOOM } from '~/shared/map/Camera';
import type { LayerSpec } from '~/shared/map/types';

/**
 * What a viewer has chosen to look at, and what that draws.
 *
 * Pure: the page owns this as plain state and hands it here to get layers back,
 * so what the map shows is a function of the payload and the choices, with
 * nothing in between that could disagree.
 */
export interface ViewerState {
  sourceId: string | null;
  visualization: string | null;
  stepIndex: number;
  /**
   * Where in time the viewer is, independent of any one source's steps.
   *
   * Sources step at their own cadences, so a source switch has to re-find the
   * step nearest to a date. Re-deriving that date from the step just landed on
   * would make each switch drift: a month lands on the week whose middle is
   * nearest, whose own middle then lands on a different month. Anchoring to the
   * date the viewer actually chose keeps a switch back exact.
   */
  anchor: number;
  /** Keyed by overlay id, seeded from how the visualizer was published. */
  overlays: Record<number, { visible: boolean; opacity: number }>;
  /** Per-overlay colour edits the viewer made, never persisted. */
  renderOverrides: Record<number, RenderOverride>;
  /** Which configured backdrop is drawn. Null means none - except where the
   *  visualizer configured none at all, when the built-in one stands in. */
  basemapId: number | null;
}

const OVERLAY_Z = 3;
const VECTOR_Z = 8;

export function initialState(view: VisualizerViewOut): ViewerState {
  const source = view.imagery[0] ?? null;
  return {
    sourceId: source?.id ?? null,
    visualization: source?.visualizations[0] ?? null,
    // The newest imagery is what people want to see first.
    stepIndex: Math.max(0, (source?.steps.length ?? 1) - 1),
    anchor: midpointOf(source?.steps[(source?.steps.length ?? 1) - 1]),
    overlays: Object.fromEntries(
      view.overlays.map((o) => [o.id, { visible: o.visible, opacity: o.opacity }])
    ),
    renderOverrides: {},
    basemapId: view.basemaps[0]?.id ?? null,
  };
}

export function activeSource(
  view: VisualizerViewOut,
  state: ViewerState
): VisualizerImageryOut | null {
  return view.imagery.find((entry) => entry.id === state.sourceId) ?? null;
}

/**
 * Move to another source without losing the viewer's place in time, or to none
 * at all - a map of overlays over the backdrop is a thing people want to see.
 *
 * Sources cover their own periods at their own cadence, so the step index means
 * nothing across a switch - the date does. Keeps the visualization too when the
 * new source publishes one by that name, so switching sensor reads as a
 * comparison rather than a jump.
 */
export function selectSource(
  view: VisualizerViewOut,
  state: ViewerState,
  sourceId: string | null
): ViewerState {
  if (sourceId === null) return { ...state, sourceId: null };
  const next = view.imagery.find((entry) => entry.id === sourceId);
  if (!next) return state;
  return {
    ...state,
    sourceId,
    visualization: next.visualizations.includes(state.visualization ?? '')
      ? state.visualization
      : (next.visualizations[0] ?? null),
    stepIndex: nearestStepIndex(next.steps, state.anchor),
  };
}

/**
 * Put the map back the way it was when a remark was made.
 *
 * Feedback records what was on screen as one string ("<source> - <date>"),
 * because a source or a date can be gone by the time it is read. Both halves
 * can contain the separator, so a name that prefixes the string is only a
 * candidate: the one whose remainder is a date it actually publishes wins.
 * Anything that no longer resolves leaves the map where it is.
 */
export function restoreViewing(
  view: VisualizerViewOut,
  state: ViewerState,
  viewing: string | null
): ViewerState {
  if (!viewing) return state;
  const candidates = view.imagery
    .filter((entry) => viewing.startsWith(`${entry.name} - `))
    .sort((a, b) => b.name.length - a.name.length);

  for (const source of candidates) {
    const label = viewing.slice(source.name.length + 3);
    const stepIndex = source.steps.findIndex((step) => step.label === label);
    if (stepIndex !== -1) {
      return selectStep(view, selectSource(view, state, source.id), stepIndex);
    }
  }
  const source = candidates[0];
  return source ? selectSource(view, state, source.id) : state;
}

/** Move along the current source's timeline, which is what sets the anchor. */
export function selectStep(
  view: VisualizerViewOut,
  state: ViewerState,
  stepIndex: number
): ViewerState {
  const steps = activeSource(view, state)?.steps ?? [];
  const clamped = Math.min(Math.max(stepIndex, 0), Math.max(steps.length - 1, 0));
  return { ...state, stepIndex: clamped, anchor: midpointOf(steps[clamped]) };
}

/** The step covering an instant, or failing that the one whose middle is
 *  nearest to it. Falls back to the newest when there is nothing to compare. */
function nearestStepIndex(steps: VisualizerStepOut[], anchor: number): number {
  if (steps.length === 0) return 0;
  if (!Number.isFinite(anchor)) return steps.length - 1;

  const covering = steps.findIndex((step) => start(step) <= anchor && anchor <= end(step) + DAY_MS);
  if (covering !== -1) return covering;

  let best = 0;
  let bestDistance = Infinity;
  steps.forEach((step, index) => {
    const distance = Math.abs(midpointOf(step) - anchor);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const start = (step: VisualizerStepOut) => Date.parse(`${step.start_date}T00:00:00Z`);
const end = (step: VisualizerStepOut) => Date.parse(`${step.end_date}T00:00:00Z`);

const midpointOf = (step: VisualizerStepOut | undefined): number =>
  step ? (start(step) + end(step)) / 2 : NaN;

/**
 * The tile for a step under the chosen visualization.
 *
 * A source's visualizations are declared per source but resolved per slice, so
 * a step registered before a visualization was added simply has no tile for it.
 * Falling back to whatever that step does have keeps the map showing imagery
 * instead of going blank on one date.
 */
function tileFor(step: VisualizerStepOut, visualization: string | null) {
  const preferred = visualization ? step.tiles[visualization] : undefined;
  return preferred ?? Object.values(step.tiles)[0] ?? null;
}

export function composeLayers(view: VisualizerViewOut, state: ViewerState): LayerSpec[] {
  const layers: LayerSpec[] = [];

  const basemap = view.basemaps.find((entry) => entry.id === state.basemapId);
  if (basemap) {
    layers.push({ ...basemapLayer(basemap, basemap.tile_proxy_base), zIndex: 0 });
  } else if (view.basemaps.length === 0) {
    // A visualizer that configures no backdrop still gets coastlines and place
    // names, so imagery is never floating on an empty canvas.
    layers.push({ kind: 'gl-style', id: 'basemap', styleUrl: BASEMAP_STYLE_URL, zIndex: 0 });
  }

  const source = activeSource(view, state);
  const step = source?.steps[state.stepIndex];
  const tile = step ? tileFor(step, state.visualization) : null;
  if (source && step && tile) {
    const url = needsKeyProxy(tile.url)
      ? sliceProxyUrl(source.tile_proxy_base, step.slice_id, state.visualization ?? '')
      : tile.url;
    layers.push({
      kind: 'raster',
      id: `slice-${step.slice_id}-${state.visualization ?? 'default'}`,
      url,
      auth: tileAuth(url, tile.tiler),
      maxZoom: source.max_native_zoom ?? undefined,
      zIndex: 1,
      preload: 1,
    });
  }

  for (const overlay of view.overlays) {
    const chosen = state.overlays[overlay.id];
    if (!chosen?.visible) continue;
    const layer =
      overlay.kind === 'raster'
        ? customMapLayer(overlay, state.renderOverrides[overlay.id], chosen.opacity)
        : vectorLayer(overlay, chosen.opacity);
    if (layer) {
      layers.push({
        ...layer,
        id: `overlay-${overlay.id}`,
        zIndex: overlay.kind === 'raster' ? OVERLAY_Z : VECTOR_Z,
      });
    }
  }

  return layers;
}

/**
 * The scale this visualizer's imagery is meant to be looked at.
 *
 * An area can be a whole country, and framing one in full puts a Sentinel-2
 * mosaic a few pixels across. Sources already declare the zoom they are worth
 * viewing at, so that is the floor: a large area opens centred on itself rather
 * than in full. Roughly 5 km across the map at the usual value.
 */
export function workingZoom(view: VisualizerViewOut): number {
  return view.imagery[0]?.default_zoom ?? DEFAULT_MAP_ZOOM;
}

/** How much of the viewport the area of interest has to fill before imagery is
 *  worth looking at. Below this the map is mostly basemap and the layer reads
 *  as broken rather than as far away. */
const AREA_VISIBLE_FRACTION = 0.08;

/** Whether the map has been zoomed out past the area this visualizer is about.
 *  Undecidable without an area, which is why that reads as "not too far". */
export function zoomedPastArea(
  area: VisualizerViewOut['area'],
  bounds: [number, number, number, number]
): boolean {
  if (!area) return false;
  const viewWidth = bounds[2] - bounds[0];
  const viewHeight = bounds[3] - bounds[1];
  if (viewWidth <= 0 || viewHeight <= 0) return false;
  const widthFraction = (area.east - area.west) / viewWidth;
  const heightFraction = (area.north - area.south) / viewHeight;
  return Math.max(widthFraction, heightFraction) < AREA_VISIBLE_FRACTION;
}

/** Whether anything here is served behind the tiler cookie. */
export function needsTilerSession(view: VisualizerViewOut): boolean {
  const imagery = view.imagery.some((source) =>
    source.steps.some((step) =>
      Object.values(step.tiles).some(
        (tile) => tileAuth(tile.url, tile.tiler) === 'cookie' || source.has_api_key
      )
    )
  );
  return (
    imagery ||
    view.overlays.some((overlay) => overlay.kind === 'raster') ||
    view.basemaps.some((basemap) => basemap.has_api_key)
  );
}
