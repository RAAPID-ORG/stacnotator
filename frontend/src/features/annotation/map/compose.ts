import { type ImageryCatalog } from '../campaign/imagery';
import { type ImageryNavState } from '../campaign/imageryNav';
import { apiUrl } from '~/api/base';
import { basemapAttribution, resolveBasemapUrl, sliceRaster } from '../campaign/tileUrls';
import { applyRenderOverride, type LegendOverride } from '../campaign/tileColors';
import {
  resolveLabelStyle,
  toDraftStyleSpec,
  toStyleSpec,
  type LabelStyle,
} from '../campaign/labelStyle';
import type { ExtendedLabel } from '../campaign/annotation';
import type { WorkMode } from '../stores/campaign';
import type { GeoFeature, LayerId, LayerSpec, LonLat, StyleSpec } from './types';

export const TILE_SKELETON_LAYER_ID = 'tile-skeleton';
export const ANNOTATION_LAYER_ID = 'annotations';
export const ANNOTATION_DELTA_LAYER_ID = 'annotations-delta';
export const ANNOTATION_MARKER_LAYER_ID = 'annotations-new';

/** Saved annotations come from the tiles, from the overlay of what the tiles do
 *  not carry yet, and - for the ones another annotator just made - from the
 *  marker sitting on them. A click on any of the three is a click on one. */
export const isAnnotationLayer = (layerId: LayerId | undefined): boolean =>
  layerId === ANNOTATION_LAYER_ID ||
  layerId === ANNOTATION_DELTA_LAYER_ID ||
  layerId === ANNOTATION_MARKER_LAYER_ID;
export const EXTENT_LAYER_ID = 'task-extent';
export const CROSSHAIR_LAYER_ID = 'crosshair';
export const DRAFT_LAYER_ID = 'draft';
export const PROBE_LAYER_ID = 'probe';

/** One colour per probe, shared with the chart so a marker and its lines
 *  match. */
const PROBE_COLORS = ['#f97316', '#0891b2', '#a855f7', '#16a34a', '#e11d48', '#ca8a04'];

export const probeColor = (index: number): string => PROBE_COLORS[index % PROBE_COLORS.length];

export const probeFeatureId = (index: number): string => `probe-${index}`;

/** Which probe a clicked marker is, or null when the id is not one. */
export function probeIndexOf(featureId: string | number | undefined): number | null {
  const match = /^probe-(\d+)$/.exec(String(featureId ?? ''));
  return match ? Number(match[1]) : null;
}

/** Exported because labelling a vector feature means recognising a click or a
 *  box hit on one of these. */
export const vectorLayerId = (id: number): string => `vector-${id}`;

const TILE_SKELETON_Z = -1;
const OVERLAY_Z = 3;
const EXTENT_Z = 5;
const VECTOR_Z = 8;
const ANNOTATION_Z = 10;
const ANNOTATION_DELTA_Z = 11;
const ANNOTATION_MARKER_Z = 12;
const DRAFT_Z = 13;
const PROBE_Z = 14;
const CROSSHAIR_Z = 15;

/** Mirrors `MIN_TILE_ZOOM` in the backend's `annotation/tiles.py`, which
 *  returns empty tiles below it: one decision, spelled on both sides. A tile
 *  spans 40075 km / 2^z, so this is a ~78 km tile - a side panel still shows
 *  tens of kilometres at any latitude. The layer's own minZoom is one lower so
 *  OL scales the last real level instead of blanking. */
export const ANNOTATION_TILE_MIN_ZOOM = 9;

/** Levels of lower-resolution annotation tiles fetched ahead. Two covers a
 *  four-fold zoom-out, which is the gesture that would otherwise land on an
 *  empty map while a whole new set of tiles is fetched. */
const ANNOTATION_PRELOAD_LEVELS = 2;

const TILE_PROP_ID = 'annotation_id';
const TILE_PROP_LABEL = 'label_id';

const DEFAULT_CROSSHAIR_COLOR = '#ff0000';
const CROSSHAIR_SIZE_PX = 20;

const MARKER_RADIUS_PX = 5;
const DEFAULT_MARKER_COLOR = '#2563eb';

/** Annotations drawn over the tiles because the tiles do not carry them yet -
 *  see `campaign/annotationDelta`. `ids` is everything the delta owns, written
 *  or deleted, which is exactly what the tiles must leave alone. */
export interface DeltaOverlay {
  features: GeoFeature[];
  /** One point per annotation another annotator made while this page was open,
   *  at the top-right of its geometry. The shape itself is drawn like any
   *  other; the marker is what says it is new, and it goes when the tiles
   *  catch up. */
  markers: GeoFeature[];
  ids: ReadonlySet<number>;
}

/** How a map draws the campaign's saved annotations: the tiles it fetches, the
 *  paint it applies to them, and the overlay of what the tiles do not carry. */
export interface SavedAnnotations {
  /** The version the tiles are fetched at. */
  version: number;
  labels: ExtendedLabel[];
  /** Rendered transparent because the user is editing them locally. */
  hiddenIds?: ReadonlySet<number>;
  highlightIds?: ReadonlySet<number>;
  labelStyles?: Record<number, Partial<LabelStyle>>;
  delta?: DeltaOverlay;
}

/**
 * Everything outside the catalog that changes what is drawn. Extends the
 * imagery store's own state so the main map can pass it straight through and
 * a window can pass the same value with its own address swapped in.
 */
export interface ComposeState extends ImageryNavState {
  /** 'window' composes one collection's imagery only: no basemap, overlay,
   *  reference layers, sketch or probe - those belong to the map the user is
   *  working in. */
  target?: 'main' | 'window';
  /** Draw the tile-grid backdrop under everything. */
  tileSkeleton?: boolean;
  legendOverrides?: Record<number, LegendOverride>;
  annotations?: SavedAnnotations;
  focusExtent?: GeoFeature | null;
  crosshairPoint?: LonLat | null;
  crosshairColor?: string | null;
  draftFeatures?: GeoFeature[];
  draftLabelId?: number | null;
  probePoints?: LonLat[];
  /** The probe a click moves, drawn larger so it is obvious which one that is. */
  activeProbe?: number | null;
}

/** `v` is the version the tiles were fetched at: changing it is what fetches
 *  them again, through both the browser and OL caches. `include_tasks` is
 *  always spelled out so a filtered tile and an unfiltered one are different
 *  URLs - neither the HTTP cache nor a retained OL source can mix them. */
export const annotationTilesUrl = (campaignId: number, version: number, includeTasks: boolean) =>
  apiUrl(
    `/api/campaigns/${campaignId}/annotations/tiles/{z}/{x}/{y}.pbf` +
      `?v=${version}&include_tasks=${includeTasks}`
  );

function selectedBasemap(cat: ImageryCatalog, selectedBasemapId: string | null) {
  const id = Number(selectedBasemapId?.replace('basemap-', ''));
  return (Number.isFinite(id) ? cat.basemaps.get(id) : undefined) ?? [...cat.basemaps.values()][0];
}

const styleForLabel = (
  label: ExtendedLabel | undefined,
  override: Partial<LabelStyle> | undefined
) => (label ? resolveLabelStyle(label.color, label.geometry_type, override) : null);

const FALLBACK_TILE_STYLE: StyleSpec = {
  fill: { color: 'rgba(120,120,120,0.2)' },
  stroke: { color: 'rgba(120,120,120,1)', width: 2 },
};

type TileStyleFn = (props: Record<string, unknown>) => StyleSpec;

/** Layer updates compare style callbacks by identity, so a fresh closure per
 *  compose would re-style the whole tile layer on every render. The labels
 *  array is the weak key, so a campaign's cache dies with it. */
const tileStyles = new WeakMap<
  ExtendedLabel[],
  { labelStyles: SavedAnnotations['labelStyles']; fn: TileStyleFn }
>();

function labelStyleResolver(state: SavedAnnotations) {
  const byId = new Map(state.labels.map((l) => [l.id, l]));
  return (labelId: number) => styleForLabel(byId.get(labelId), state.labelStyles?.[labelId]);
}

/** Per-feature paint for the annotation tiles, through the same label rules
 *  the drawing layer uses. Unknown labels get the neutral fallback. */
function annotationStyle(state: SavedAnnotations): TileStyleFn {
  const cached = tileStyles.get(state.labels);
  if (cached && cached.labelStyles === state.labelStyles) return cached.fn;

  const resolve = labelStyleResolver(state);
  const fn: TileStyleFn = (props) => {
    const style = resolve(Number(props[TILE_PROP_LABEL]));
    return style ? toStyleSpec(style) : FALLBACK_TILE_STYLE;
  };
  tileStyles.set(state.labels, { labelStyles: state.labelStyles, fn });
  return fn;
}

/** The same paint for the overlay - a saved annotation looks the same whether
 *  it came from a tile or not. Selection is applied here because a feature
 *  layer has no highlight list of its own. */
function deltaStyle(state: SavedAnnotations): (feature: GeoFeature) => StyleSpec {
  const resolve = labelStyleResolver(state);
  return (feature) => {
    const style = resolve(Number((feature.properties ?? {})[TILE_PROP_LABEL]));
    if (!style) return FALLBACK_TILE_STYLE;
    return toStyleSpec(style, { selected: !!state.highlightIds?.has(Number(feature.id)) });
  };
}

/** The "this one is new" dot: the label's own colour, ringed so it reads on
 *  imagery, and no bigger than it has to be to be noticed. */
function markerStyle(state: SavedAnnotations): (feature: GeoFeature) => StyleSpec {
  const resolve = labelStyleResolver(state);
  return (feature) => {
    const style = resolve(Number((feature.properties ?? {})[TILE_PROP_LABEL]));
    return {
      circle: {
        radius: MARKER_RADIUS_PX,
        fill: { color: style?.strokeColor ?? DEFAULT_MARKER_COLOR },
        stroke: { color: '#ffffff', width: 2 },
      },
    };
  };
}

export interface ComposeContext {
  catalog: ImageryCatalog;
  mode: WorkMode;
}

/** One flat tile with a hairline border, repeated over the whole grid. Drawn
 *  by the same tile machinery as the imagery, so the squares sit exactly where
 *  the real tiles will: they fill in one by one as the imagery arrives instead
 *  of the map going white while it loads. */
const TILE_SKELETON_URL =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>" +
  "<rect width='256' height='256' fill='%23eceef1'/>" +
  "<rect x='0.5' y='0.5' width='255' height='255' fill='none' stroke='%23dcdfe4'/></svg>";

export function composeLayers(ctx: ComposeContext, state: ComposeState): LayerSpec[] {
  const { catalog, mode } = ctx;
  const isWindow = state.target === 'window';
  const layers: LayerSpec[] = [];

  if (state.tileSkeleton) {
    layers.push({
      kind: 'raster',
      id: TILE_SKELETON_LAYER_ID,
      url: TILE_SKELETON_URL,
      auth: 'none',
      zIndex: TILE_SKELETON_Z,
    });
  }

  // A task's rasters get their own cache scope: imagery must not be reused
  // across task locations even when the URL is identical.
  const taskScope =
    mode === 'tasks' && state.crosshairPoint
      ? `${state.crosshairPoint[0]}:${state.crosshairPoint[1]}`
      : undefined;

  // Imagery, or the basemap when selected - and also when there is no imagery
  // at all, so the map is never a blank canvas.
  if ((state.showBasemap || !state.address) && !isWindow) {
    const basemap = selectedBasemap(catalog, state.selectedBasemapId);
    if (basemap) {
      layers.push({
        kind: 'raster',
        id: `basemap-${basemap.id}`,
        url: resolveBasemapUrl(catalog.campaignId, basemap),
        auth: 'none',
        maxZoom: basemap.max_native_zoom ?? undefined,
        attribution: basemapAttribution(basemap.url),
      });
    }
    // No address means the view has nothing to navigate: the basemap is the
    // whole map, with nothing to overlay it with yet.
    if (!state.address) return layers;
  } else if (state.address) {
    try {
      const raster = sliceRaster(
        catalog,
        state.address,
        state.legendOverrides?.[Number(state.address.vizId)]
      );
      layers.push({ kind: 'raster', ...raster, cacheScope: taskScope });
    } catch {
      // A stale address costs the imagery layer, not the page.
    }
  }

  if (!isWindow && state.overlay.id != null && state.overlay.visible) {
    const map = catalog.customMaps.get(state.overlay.id);
    if (map?.tile_url && map.status === 'ready') {
      layers.push({
        kind: 'raster',
        id: `custom-map-${map.id}`,
        url: applyRenderOverride(map.tile_url, map.render_config, state.legendOverrides?.[map.id]),
        auth: 'cookie',
        opacity: state.overlayOpacity ?? 1,
        maxZoom: map.max_native_zoom ?? undefined,
        cacheScope: taskScope,
        zIndex: OVERLAY_Z,
      });
    }
  }

  if (state.focusExtent) {
    layers.push({
      kind: 'features',
      id: EXTENT_LAYER_ID,
      features: [state.focusExtent],
      style: {
        stroke: {
          color: state.crosshairColor ?? DEFAULT_CROSSHAIR_COLOR,
          width: 2,
          dash: [6, 4],
        },
      },
      zIndex: EXTENT_Z,
    });
  }

  // Reference layers give campaign context in both modes. Windows never carry
  // them; selection belongs to the map.
  if (!isWindow && state.vector.id != null && state.vector.visible) {
    const vector = catalog.vectorLayers.get(state.vector.id);
    if (vector) {
      layers.push({
        kind: 'vector-tiles',
        id: vectorLayerId(vector.id),
        url: vector.pmtiles_url,
        sourceLayers: vector.source_layer ? [vector.source_layer] : undefined,
        style: { stroke: { color: vector.color, width: 1.5 }, fill: { color: vector.color } },
        zIndex: VECTOR_Z,
      });
    }
  }

  // Saved annotations are Explore's subject. A task map shows only what the
  // page is pointed at - its footprint and crosshair - and so do its windows,
  // where a point task's own annotation would just sit under the crosshair.
  if (mode === 'explore' && state.showAnnotations && state.annotations) {
    const annotations = state.annotations;
    // Whatever the overlay draws, the tiles do not: their copy is out of date
    // (or gone), and drawing both would double every shape.
    const hidden = new Set<string | number>([
      ...(annotations.hiddenIds ?? []),
      ...(annotations.delta?.ids ?? []),
    ]);
    layers.push({
      kind: 'vector-tiles',
      id: ANNOTATION_LAYER_ID,
      url: annotationTilesUrl(catalog.campaignId, annotations.version, state.showTaskAnnotations),
      auth: 'bearer',
      idProperty: TILE_PROP_ID,
      minZoom: ANNOTATION_TILE_MIN_ZOOM - 1,
      preload: ANNOTATION_PRELOAD_LEVELS,
      style: annotationStyle(annotations),
      hiddenFeatureIds: hidden,
      highlightFeatureIds: annotations.highlightIds,
      zIndex: ANNOTATION_Z,
    });

    // The shape under an open edit is drawn by the edit interaction, so the
    // overlay leaves it alone the same way the tiles do.
    const overlay = (annotations.delta?.features ?? []).filter(
      (feature) => !annotations.hiddenIds?.has(Number(feature.id))
    );
    if (overlay.length > 0) {
      layers.push({
        kind: 'features',
        id: ANNOTATION_DELTA_LAYER_ID,
        features: overlay,
        style: deltaStyle(annotations),
        // Stops where the tiles stop: a whole-region view must not advertise
        // this session's shapes when it draws nobody else's.
        minZoom: ANNOTATION_TILE_MIN_ZOOM - 1,
        zIndex: ANNOTATION_DELTA_Z,
      });
    }

    const markers = annotations.delta?.markers ?? [];
    if (markers.length > 0) {
      layers.push({
        kind: 'features',
        id: ANNOTATION_MARKER_LAYER_ID,
        features: markers,
        style: markerStyle(annotations),
        minZoom: ANNOTATION_TILE_MIN_ZOOM - 1,
        zIndex: ANNOTATION_MARKER_Z,
      });
    }
  }

  if (state.showAnnotations && !isWindow && state.draftFeatures?.length) {
    const label = state.annotations?.labels.find((l) => l.id === state.draftLabelId);
    const style = styleForLabel(label, state.annotations?.labelStyles?.[state.draftLabelId ?? -1]);
    layers.push({
      kind: 'features',
      id: DRAFT_LAYER_ID,
      features: state.draftFeatures,
      style: style
        ? toDraftStyleSpec(style)
        : { stroke: { color: 'rgba(255,255,255,0.9)', width: 2, dash: [6, 4] } },
      zIndex: DRAFT_Z,
    });
  }

  if (!isWindow && state.probePoints?.length) {
    layers.push({
      kind: 'features',
      id: PROBE_LAYER_ID,
      features: state.probePoints.map((point, index) => ({
        id: probeFeatureId(index),
        geometry: { type: 'Point', coordinates: point },
      })),
      // Marker colour matches the chart series for the same probe, which is
      // what makes "this line is that dot" readable at a glance; the active
      // one wears a heavier ring, being the one a click would move.
      style: (feature) => {
        const index = probeIndexOf(feature.id) ?? 0;
        const isActive = index === state.activeProbe;
        return {
          circle: {
            radius: isActive ? 7 : 5,
            fill: { color: probeColor(index) },
            stroke: { color: '#ffffff', width: isActive ? 3 : 1.5 },
          },
        };
      },
      zIndex: PROBE_Z,
    });
  }

  if (state.crosshair && state.crosshairPoint) {
    layers.push({
      kind: 'features',
      id: CROSSHAIR_LAYER_ID,
      features: [
        { id: CROSSHAIR_LAYER_ID, geometry: { type: 'Point', coordinates: state.crosshairPoint } },
      ],
      style: {
        cross: {
          size: CROSSHAIR_SIZE_PX,
          stroke: { color: state.crosshairColor ?? DEFAULT_CROSSHAIR_COLOR, width: 1.5 },
        },
      },
      zIndex: CROSSHAIR_Z,
    });
  }

  return layers;
}
