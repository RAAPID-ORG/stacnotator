import type { ExtendedLabel, LabelStyle } from '~/features/annotation/core/annotation';
import {
  resolveLabelStyle,
  toDraftStyleSpec,
  toStyleSpec,
} from '~/features/annotation/core/annotation';
import {
  applyRenderOverride,
  basemapAttribution,
  layerSpecFor,
  resolveBasemapUrl,
  type Catalog,
  type ImageryNavState,
  type LegendOverride,
} from '~/features/annotation/core/catalog';
import type { GeoFeature, LayerSpec, LonLat, StyleSpec } from '~/features/annotation/engine/map';
import type { ComposeCtx } from '../composition';

export const ANNOTATION_LAYER_ID = 'annotations';
export const EXTENT_LAYER_ID = 'task-extent';
export const CROSSHAIR_LAYER_ID = 'crosshair';
export const DRAFT_LAYER_ID = 'draft';
export const PROBE_LAYER_ID = 'probe';

/** Layer id of a reference vector layer. Exported because labelling vector
 *  features means recognising a click or a box hit on one of these. */
export const vectorLayerId = (id: number): string => `vector-${id}`;

const OVERLAY_Z = 3;
const EXTENT_Z = 5;
const VECTOR_Z = 8;
const ANNOTATION_Z = 10;
const DRAFT_Z = 11;
const PROBE_Z = 12;
const CROSSHAIR_Z = 13;

/** Below this zoom a whole-region view of dense annotations is unreadable and
 *  the tile request is huge, so the layer stays off (old
 *  useAnnotationTileLayer.ts:45-49; the layer's minZoom is one below the
 *  request threshold so OL scales the last real zoom level instead of
 *  blanking). */
export const ANNOTATION_TILE_MIN_ZOOM = 11;

const TILE_PROP_ID = 'annotation_id';
const TILE_PROP_LABEL = 'label_id';

const DEFAULT_CROSSHAIR_COLOR = '#ff0000';
const CROSSHAIR_SIZE_PX = 20;

export interface AnnotationTileState {
  /** Bumped after every write so the tiles are refetched. */
  version: number;
  labels: ExtendedLabel[];
  /** Rendered transparent because the user is editing them locally. */
  hiddenIds?: Array<string | number>;
  highlightIds?: Array<string | number>;
  labelStyles?: Record<number, Partial<LabelStyle>>;
}

/**
 * Everything outside the catalog that changes what is drawn. It extends the
 * imagery store's own state so the main map can pass `useImageryStore` state
 * straight through, and a window can pass the same value with its collection's
 * address swapped in.
 */
export interface ComposeState extends ImageryNavState {
  /** 'window' composes one collection's imagery only: no basemap, overlay,
   *  vector reference layers, sketch or probe - those belong to the map the
   *  user is working in. */
  target?: 'main' | 'window';
  legendOverrides?: Record<number, LegendOverride>;
  annotations?: AnnotationTileState;
  /** Task footprint / sample extent, already in EPSG:4326. */
  focusExtent?: GeoFeature | null;
  /** Where the crosshair sits (the task point in tasks mode). */
  crosshairPoint?: LonLat | null;
  crosshairColor?: string | null;
  /** The not-yet-saved sketch, drawn like an annotation but dashed. */
  draftFeatures?: GeoFeature[];
  draftLabelId?: number | null;
  probePoint?: LonLat | null;
}

/** Tile endpoint of a campaign's saved annotations. `v` busts the browser and
 *  OL tile caches after an edit. */
export function annotationTilesUrl(campaignId: number, version: number): string {
  return `/api/campaigns/${campaignId}/annotations/tiles/{z}/{x}/{y}.pbf?v=${version}`;
}

function selectedBasemap(cat: Catalog, selectedBasemapId: string | null) {
  const id = Number(selectedBasemapId?.replace('basemap-', ''));
  return (Number.isFinite(id) ? cat.basemaps.get(id) : undefined) ?? [...cat.basemaps.values()][0];
}

function styleForLabel(
  label: ExtendedLabel | undefined,
  override: Partial<LabelStyle> | undefined
): LabelStyle | null {
  return label ? resolveLabelStyle(label.color, label.geometry_type, override) : null;
}

type TileStyleFn = (props: Record<string, unknown>) => StyleSpec;

const FALLBACK_TILE_STYLE: StyleSpec = {
  fill: { color: 'rgba(120,120,120,0.2)' },
  stroke: { color: 'rgba(120,120,120,1)', width: 2 },
};

/** reconcile compares style callbacks by identity, so a fresh closure per
 *  compose would re-style the whole tile layer on every render. Cached against
 *  the two inputs it closes over; the labels array is the weak key, so a
 *  campaign's cache dies with it. */
const tileStyles = new WeakMap<
  ExtendedLabel[],
  { labelStyles: AnnotationTileState['labelStyles']; fn: TileStyleFn }
>();

/** Per-feature paint for the annotation tiles, resolved through the same
 *  label style rules the drawing layer uses. Unknown labels render in the
 *  neutral fallback style. */
function annotationStyle(state: AnnotationTileState): TileStyleFn {
  const cached = tileStyles.get(state.labels);
  if (cached && cached.labelStyles === state.labelStyles) return cached.fn;

  const byId = new Map(state.labels.map((l) => [l.id, l]));
  const fn: TileStyleFn = (props) => {
    const labelId = Number(props[TILE_PROP_LABEL]);
    const style = styleForLabel(byId.get(labelId), state.labelStyles?.[labelId]);
    return style ? toStyleSpec(style) : FALLBACK_TILE_STYLE;
  };
  tileStyles.set(state.labels, { labelStyles: state.labelStyles, fn });
  return fn;
}

function crosshairStyle(color: string): StyleSpec {
  return { cross: { size: CROSSHAIR_SIZE_PX, stroke: { color, width: 1.5 } } };
}

export function composeLayers(ctx: ComposeCtx, state: ComposeState): LayerSpec[] {
  const { catalog } = ctx;
  const isWindow = state.target === 'window';
  const layers: LayerSpec[] = [];

  // Imagery, or the basemap when it is selected - and also when there is no
  // imagery to show at all, so the map is never a blank canvas.
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
    // No address at all means the view has no imagery to navigate (or the
    // campaign is still loading): the fallback basemap is the whole map, with
    // nothing to overlay it with yet.
    if (!state.address) return layers;
  } else if (state.address) {
    // layerSpecFor throws on an address the catalog no longer knows (a
    // collection deleted while a saved view snapshot still points at it).
    // Composing is a render path, so a stale address costs the imagery
    // layer, not the page.
    try {
      const spec = layerSpecFor(
        catalog,
        state.address,
        state.legendOverrides?.[Number(state.address.vizId)]
      );
      layers.push(spec);
    } catch {
      /* no imagery for this address */
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
        zIndex: OVERLAY_Z,
      });
    }
  }

  if (state.focusExtent) {
    layers.push({
      kind: 'features',
      id: EXTENT_LAYER_ID,
      features: [state.focusExtent],
      style: { stroke: { color: 'rgba(255,255,255,0.9)', width: 2, dash: [6, 4] } },
      zIndex: EXTENT_Z,
    });
  }

  // Reference vector layers are an Explore affordance (V / Shift+V); a task
  // map stays on the task. Windows never carry them.
  if (!isWindow && ctx.mode === 'explore' && state.vector.id != null && state.vector.visible) {
    const vector = catalog.vectorLayers.get(state.vector.id);
    if (vector) {
      layers.push({
        kind: 'vector-tiles',
        id: vectorLayerId(vector.id),
        url: vector.pmtiles_url,
        sourceLayers: vector.source_layer ? [vector.source_layer] : undefined,
        style: {
          stroke: { color: vector.color, width: 1.5 },
          fill: { color: vector.color },
        },
        zIndex: VECTOR_Z,
      });
    }
  }

  // Saved annotations are Explore's subject; a task map shows only the task's
  // own footprint, so tasks mode leaves the tiles out entirely (old
  // TaskModeMap mounted no annotation layer). Windows carry them in both
  // modes, which is what the Shift+X check below has to reach.
  const showsAnnotations = ctx.mode === 'explore' || isWindow;

  // Shift+X. One check, on the path both the main map and the windows take.
  if (showsAnnotations && state.showAnnotations && state.annotations) {
    layers.push({
      kind: 'vector-tiles',
      id: ANNOTATION_LAYER_ID,
      url: annotationTilesUrl(catalog.campaignId, state.annotations.version),
      idProperty: TILE_PROP_ID,
      minZoom: ANNOTATION_TILE_MIN_ZOOM - 1,
      style: annotationStyle(state.annotations),
      hiddenFeatureIds: state.annotations.hiddenIds,
      highlightFeatureIds: state.annotations.highlightIds,
      zIndex: ANNOTATION_Z,
    });
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

  if (!isWindow && state.probePoint) {
    layers.push({
      kind: 'features',
      id: PROBE_LAYER_ID,
      features: [
        { id: PROBE_LAYER_ID, geometry: { type: 'Point', coordinates: state.probePoint } },
      ],
      style: {
        circle: {
          radius: 5,
          fill: { color: '#f59e0b' },
          stroke: { color: '#ffffff', width: 1.5 },
        },
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
      style: crosshairStyle(state.crosshairColor ?? DEFAULT_CROSSHAIR_COLOR),
      zIndex: CROSSHAIR_Z,
    });
  }

  return layers;
}
