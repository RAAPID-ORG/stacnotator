/**
 * Annotation vector-tile display layers for the open-mode maps.
 *
 * Existing annotations are served as MVT tiles in the viewport instead of being
 * loaded upfront. Two layers share one endpoint:
 *   - a display layer that colours every annotation by label and renders the
 *     feature currently being edited transparent (the editable DrawingLayer owns
 *     that one);
 *   - a thin highlight overlay that strokes only the multi-selected annotations.
 *
 * Both use the canvas vector-tile renderer (see createAnnotationDisplayLayer for
 * why WebGL is deferred). A per-campaign version integer in the tile URL busts
 * the cache after edits.
 */
import { useEffect, useRef } from 'react';
import type OLMap from 'ol/Map';
import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import type VectorTile from 'ol/VectorTile';
import MVT from 'ol/format/MVT';
import type RenderFeature from 'ol/render/Feature';
import type { Projection } from 'ol/proj';
import { createXYZ } from 'ol/tilegrid';
import { Style, Stroke, Fill } from 'ol/style';
import type { FeatureLike } from 'ol/Feature';

import { authManager } from '~/features/auth/index';
import { extendLabelsWithMetadata } from '../../utils/labelMetadata';
import { resolveLabelStyle, styleKey, type StyleOverrides } from '../../utils/annotationStyle';
import { hexToRgba, ANNOTATION_LAYER_Z_INDEX, ANNOTATION_TILE_LAYER_FLAG } from './mapUtils';
import type { TileLabelStyle } from '../../utils/annotationTileStyle';
import { useAnnotationStore } from '../../stores/annotation.store';
import { useMapStore } from '../../stores/map.store';
import { usePreferencesStore } from '../../stores/preferences.store';
import type { CampaignOutFull } from '~/api/client';

const DEFAULT_FILL = 'rgba(120,120,120,0.2)';
const DEFAULT_STROKE = 'rgba(120,120,120,1)';

// MVT feature property names emitted by the backend (ST_AsMVT column aliases).
const TILE_PROP_ID = 'annotation_id';
const TILE_PROP_LABEL = 'label_id';
const HIGHLIGHT_Z_INDEX = ANNOTATION_LAYER_Z_INDEX + 1;
const apiBase = import.meta.env.VITE_API_BASE_URL ?? '';

// Don't request annotation tiles when zoomed out: a whole-region view of dense
// campaigns is a multi-MB, CPU-heavy MVT query. The backend also floors this
// (ANNOTATION_TILE_MIN_ZOOM), so the layer is hidden below it either way; this just
// avoids firing empty requests. OL's `minZoom` is exclusive, hence the -1.
const ANNOTATION_TILE_MIN_ZOOM = 11;

/** Resolve each campaign label to the paint the tiles use, honouring overrides. */
function resolveTileLabelStyles(
  campaign: CampaignOutFull,
  overrides: StyleOverrides
): TileLabelStyle[] {
  return extendLabelsWithMetadata(campaign.settings.labels).map((label) => {
    const style = resolveLabelStyle(
      label.color,
      label.geometry_type,
      overrides[styleKey(campaign.id, label.id)]
    );
    return {
      id: label.id,
      fillColor: hexToRgba(style.fillColor, style.fillOpacity),
      strokeColor: hexToRgba(style.strokeColor, style.strokeOpacity),
      strokeWidth: style.strokeWidth,
    };
  });
}

/** MVT source for a campaign's annotation tiles, authenticated like the API
 * client (bearer token + credentials) and versioned for cache-busting. */
function createAnnotationTileSource(
  campaignId: number,
  getVersion: () => number
): VectorTileSource {
  const format = new MVT({ idProperty: TILE_PROP_ID });
  const source = new VectorTileSource({
    format,
    tileGrid: createXYZ({ maxZoom: 22 }),
    url: `${apiBase}/api/campaigns/${campaignId}/annotations/tiles/{z}/{x}/{y}.pbf`,
  });

  source.setTileUrlFunction((tileCoord) => {
    const [z, x, y] = tileCoord;
    return `${apiBase}/api/campaigns/${campaignId}/annotations/tiles/${z}/${x}/${y}.pbf?v=${getVersion()}`;
  });

  source.setTileLoadFunction((tile, url) => {
    const vTile = tile as VectorTile<RenderFeature>;
    vTile.setLoader(async (extent, _resolution, projection) => {
      const token = await authManager.getIdToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const resp = await fetch(url, { headers, credentials: 'include' });
      if (!resp.ok) {
        vTile.setFeatures([]);
        return [];
      }
      const data = await resp.arrayBuffer();
      const features = format.readFeatures(data, {
        extent,
        featureProjection: projection as Projection,
      });
      vTile.setFeatures(features);
      return features;
    });
  });

  return source;
}

/** Read-only display layer colouring annotations by label. Reused by the main
 * open-mode map and the secondary window maps.
 *
 * Uses the canvas vector-tile renderer (the feature whose id matches the live
 * editingId is hidden so the editable layer owns it). A WebGL renderer is the
 * intended optimisation - the tested flat-style builder in annotationTileStyle
 * is ready for that swap - but OpenLayers' WebGL vector-tile path does not use
 * the authenticated setFeatures loader this needs.
 */
export function createAnnotationDisplayLayer(
  campaign: CampaignOutFull,
  overrides: StyleOverrides,
  getVersion: () => number
): VectorTileLayer {
  const styleByLabel = new Map<number, TileLabelStyle>(
    resolveTileLabelStyles(campaign, overrides).map((s) => [s.id, s])
  );
  const styleCache = new Map<number, Style>();

  const layer = new VectorTileLayer({
    source: createAnnotationTileSource(campaign.id, getVersion),
    zIndex: ANNOTATION_LAYER_Z_INDEX,
    minZoom: ANNOTATION_TILE_MIN_ZOOM - 1,
    // Re-render during zoom/pan so strokes stay crisp instead of the prior
    // zoom level's tiles being scaled up (which makes polygons "pulse").
    updateWhileAnimating: true,
    updateWhileInteracting: true,
    style: (feature: FeatureLike) => {
      const id = feature.getId();
      if (id != null && id === useAnnotationStore.getState().editingId) return undefined;
      const labelId = (feature.get(TILE_PROP_LABEL) as number | null) ?? -1;
      const cached = styleCache.get(labelId);
      if (cached) return cached;
      const s = styleByLabel.get(labelId);
      const style = new Style({
        fill: new Fill({ color: s?.fillColor ?? DEFAULT_FILL }),
        stroke: new Stroke({ color: s?.strokeColor ?? DEFAULT_STROKE, width: s?.strokeWidth ?? 2 }),
      });
      styleCache.set(labelId, style);
      return style;
    },
  });
  layer.set(ANNOTATION_TILE_LAYER_FLAG, true);
  return layer;
}

/** Highlight overlay: own MVT source (tiles are browser-cached so no extra
 * network), canvas-rendered so the style fn can read the live selection Set.
 * Selection keeps the label colour and is emphasised with a thicker stroke
 * (no recolour), drawn on top of the display layer. */
function createAnnotationHighlightLayer(
  campaign: CampaignOutFull,
  overrides: StyleOverrides,
  getVersion: () => number
): VectorTileLayer {
  const styleByLabel = new Map<number, TileLabelStyle>(
    resolveTileLabelStyles(campaign, overrides).map((s) => [s.id, s])
  );
  const highlightCache = new Map<number, Style>();
  return new VectorTileLayer({
    source: createAnnotationTileSource(campaign.id, getVersion),
    zIndex: HIGHLIGHT_Z_INDEX,
    updateWhileAnimating: true,
    updateWhileInteracting: true,
    style: (feature: FeatureLike) => {
      const id = feature.getId() ?? feature.get(TILE_PROP_ID);
      const state = useAnnotationStore.getState();
      // The actively-edited feature is drawn (with vertices) by the edit layer.
      if (
        id == null ||
        id === state.editingId ||
        !state.selectedAnnotationIds.includes(id as number)
      )
        return undefined;
      const labelId = (feature.get(TILE_PROP_LABEL) as number | null) ?? -1;
      const cached = highlightCache.get(labelId);
      if (cached) return cached;
      const s = styleByLabel.get(labelId);
      const style = new Style({
        stroke: new Stroke({
          color: s?.strokeColor ?? DEFAULT_STROKE,
          width: (s?.strokeWidth ?? 2) + 3,
        }),
      });
      highlightCache.set(labelId, style);
      return style;
    },
  });
}

/** Build the display + highlight layer pair for the current tile version. */
function buildAnnotationLayers(
  campaign: CampaignOutFull,
  overrides: StyleOverrides,
  getVersion: () => number,
  visible: boolean
): { display: VectorTileLayer; highlight: VectorTileLayer } {
  const display = createAnnotationDisplayLayer(campaign, overrides, getVersion);
  const highlight = createAnnotationHighlightLayer(campaign, overrides, getVersion);
  display.setVisible(visible);
  highlight.setVisible(visible);
  return { display, highlight };
}

export function useAnnotationTileLayer(map: OLMap | null, campaign: CampaignOutFull | null): void {
  const displayRef = useRef<VectorTileLayer | null>(null);
  const highlightRef = useRef<VectorTileLayer | null>(null);
  // Every annotation layer currently on the map. During a version hot-swap the
  // outgoing pair lingers until the incoming pair has painted, so more than one
  // pair can be present briefly; this is the authoritative cleanup list.
  const allLayersRef = useRef<VectorTileLayer[]>([]);
  // The last tile version we (re)built layers for, so the swap effect ignores
  // both the initial mount and the version a fresh build already reflects.
  const builtVersionRef = useRef(0);

  const styleOverrides = usePreferencesStore((s) => s.annotationStyles);
  const getVersion = () => useAnnotationStore.getState().tileVersion;

  // Build (and rebuild on campaign / style change).
  useEffect(() => {
    if (!map || !campaign) return;

    const { display, highlight } = buildAnnotationLayers(
      campaign,
      styleOverrides,
      getVersion,
      useMapStore.getState().showAnnotations
    );
    map.addLayer(display);
    map.addLayer(highlight);
    displayRef.current = display;
    highlightRef.current = highlight;
    allLayersRef.current = [display, highlight];
    builtVersionRef.current = useAnnotationStore.getState().tileVersion;

    return () => {
      for (const layer of allLayersRef.current) map.removeLayer(layer);
      allLayersRef.current = [];
      displayRef.current = null;
      highlightRef.current = null;
    };
  }, [map, campaign, styleOverrides]);

  // Reload on version change via a double-buffered hot-swap. VectorTileSource
  // has no interim-tile support, so refresh()/re-keying both blank every tile
  // before the reload lands — a full-layer flash that looks like all annotations
  // changed. Instead build a fresh pair at the new version and keep the current
  // pair on screen until the new tiles have painted (rendercomplete), then drop
  // the old pair. Existing annotations never disappear; only changed tiles move.
  const tileVersion = useAnnotationStore((s) => s.tileVersion);
  useEffect(() => {
    if (!map || !campaign) return;
    if (tileVersion === builtVersionRef.current) return;
    builtVersionRef.current = tileVersion;

    const { display, highlight } = buildAnnotationLayers(
      campaign,
      styleOverrides,
      getVersion,
      useMapStore.getState().showAnnotations
    );
    const outgoing = allLayersRef.current;
    map.addLayer(display);
    map.addLayer(highlight);
    allLayersRef.current = [...outgoing, display, highlight];
    displayRef.current = display;
    highlightRef.current = highlight;

    map.once('rendercomplete', () => {
      for (const layer of outgoing) map.removeLayer(layer);
      allLayersRef.current = allLayersRef.current.filter((l) => !outgoing.includes(l));
    });
  }, [map, campaign, tileVersion, styleOverrides]);

  // Re-render the display layer when the edited feature changes so its style fn
  // hides/reveals the right id.
  const editingId = useAnnotationStore((s) => s.editingId);
  useEffect(() => {
    displayRef.current?.changed();
    highlightRef.current?.changed();
  }, [editingId]);

  // Re-evaluate the highlight overlay when the multi-selection changes.
  const selectedIds = useAnnotationStore((s) => s.selectedAnnotationIds);
  useEffect(() => {
    highlightRef.current?.changed();
  }, [selectedIds]);

  // Toggle every current layer with the global annotation visibility switch
  // (there may be two pairs mid-swap).
  const showAnnotations = useMapStore((s) => s.showAnnotations);
  useEffect(() => {
    for (const layer of allLayersRef.current) layer.setVisible(showAnnotations);
  }, [showAnnotations]);
}
