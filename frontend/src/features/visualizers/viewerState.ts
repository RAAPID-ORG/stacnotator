import type { VisualizerImageryOut, VisualizerStepOut, VisualizerViewOut } from '~/api/client';
import { applyRenderOverride, type RenderOverride } from '~/shared/imagery/tileColors';
import { needsKeyProxy, sliceProxyUrl } from '~/shared/imagery/tileUrls';
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
  /** Keyed by overlay id, seeded from how the visualizer was published. */
  overlays: Record<number, { visible: boolean; opacity: number }>;
  /** Per-overlay colour edits the viewer made, never persisted. */
  renderOverrides: Record<number, RenderOverride>;
}

/** One keyless backdrop, so imagery has coastlines and place names around it
 *  without anyone having to choose. */
const BASEMAP_URL = 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';

const BASEMAP_ATTRIBUTION =
  '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const OVERLAY_Z = 3;
const VECTOR_Z = 8;

export function initialState(view: VisualizerViewOut): ViewerState {
  const source = view.imagery[0] ?? null;
  return {
    sourceId: source?.id ?? null,
    visualization: source?.visualizations[0] ?? null,
    // The newest imagery is what people want to see first.
    stepIndex: Math.max(0, (source?.steps.length ?? 1) - 1),
    overlays: Object.fromEntries(
      view.overlays.map((o) => [o.id, { visible: o.visible, opacity: o.opacity }])
    ),
    renderOverrides: {},
  };
}

export function activeSource(
  view: VisualizerViewOut,
  state: ViewerState
): VisualizerImageryOut | null {
  return view.imagery.find((entry) => entry.id === state.sourceId) ?? null;
}

export function activeStep(view: VisualizerViewOut, state: ViewerState): VisualizerStepOut | null {
  const source = activeSource(view, state);
  return source?.steps[state.stepIndex] ?? null;
}

/**
 * Move to another source without losing the viewer's place in time.
 *
 * Sources cover their own periods at their own cadence, so the step index means
 * nothing across a switch - the date does. Keeps the visualization too when the
 * new source publishes one by that name, so switching sensor reads as a
 * comparison rather than a jump.
 */
export function selectSource(
  view: VisualizerViewOut,
  state: ViewerState,
  sourceId: string
): ViewerState {
  const next = view.imagery.find((entry) => entry.id === sourceId);
  if (!next) return state;
  const current = activeStep(view, state);
  return {
    ...state,
    sourceId,
    visualization: next.visualizations.includes(state.visualization ?? '')
      ? state.visualization
      : (next.visualizations[0] ?? null),
    stepIndex: current ? nearestStepIndex(next.steps, current.start_date) : next.steps.length - 1,
  };
}

/** The step whose midpoint is closest to a date, or 0 when there are none. */
export function nearestStepIndex(steps: VisualizerStepOut[], isoDate: string): number {
  if (steps.length === 0) return 0;
  const target = midpoint({ start_date: isoDate, end_date: isoDate });
  let best = 0;
  let bestDistance = Infinity;
  steps.forEach((step, index) => {
    const distance = Math.abs(midpoint(step) - target);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

const midpoint = (step: { start_date: string; end_date: string }): number =>
  (Date.parse(`${step.start_date}T00:00:00Z`) + Date.parse(`${step.end_date}T00:00:00Z`)) / 2;

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

  layers.push({
    kind: 'raster',
    id: 'basemap',
    url: BASEMAP_URL,
    auth: 'none',
    zIndex: 0,
    attribution: BASEMAP_ATTRIBUTION,
  });

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
      auth: tile.provider === 'mpc' ? 'none' : 'cookie',
      maxZoom: source.max_native_zoom ?? undefined,
      zIndex: 1,
      preload: 1,
    });
  }

  for (const overlay of view.overlays) {
    const chosen = state.overlays[overlay.id];
    if (!chosen?.visible) continue;
    if (overlay.kind === 'raster') {
      if (!overlay.tile_url) continue;
      layers.push({
        kind: 'raster',
        id: `overlay-${overlay.id}`,
        url: applyRenderOverride(
          overlay.tile_url,
          overlay.render_config,
          state.renderOverrides[overlay.id]
        ),
        auth: 'cookie',
        opacity: chosen.opacity,
        maxZoom: overlay.max_native_zoom ?? undefined,
        zIndex: OVERLAY_Z,
      });
      continue;
    }
    layers.push({
      kind: 'vector-tiles',
      id: `overlay-${overlay.id}`,
      url: overlay.pmtiles_url,
      auth: 'none',
      opacity: chosen.opacity,
      sourceLayers: overlay.source_layer ? [overlay.source_layer] : undefined,
      style: {
        stroke: { color: overlay.color, width: 1.5 },
        fill: { color: `${overlay.color}33` },
      },
      zIndex: VECTOR_Z,
    });
  }

  return layers;
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

/** Every campaign whose tiles this visualizer needs a tiler session for. */
export function needsTilerSession(view: VisualizerViewOut): boolean {
  const imagery = view.imagery.some((source) =>
    source.steps.some((step) =>
      Object.values(step.tiles).some((tile) => tile.provider !== 'mpc' || source.has_api_key)
    )
  );
  return imagery || view.overlays.some((overlay) => overlay.kind === 'raster');
}
