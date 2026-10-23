import { apiUrl } from '~/api/base';
import type { RasterLayerSpec, VectorTileLayerSpec } from '~/shared/map/types';
import { applyRenderOverride, type RenderOverride } from './tileColors';
import { basemapAttribution, isProxiedTileUrl, needsKeyProxy } from './tileUrls';

/** How each kind of layer a campaign or a visualizer owns is drawn, whichever
 *  page draws it. */

interface BasemapLike {
  id: number;
  url: string;
  max_native_zoom?: number | null;
}

/** ``proxyBase`` is the owner's basemap proxy route, which serves the
 *  provider's tiles with the key the backend holds. */
export function basemapLayer(basemap: BasemapLike, proxyBase: string): RasterLayerSpec {
  const url = needsKeyProxy(basemap.url)
    ? apiUrl(`${proxyBase}/${basemap.id}/tiles/{z}/{x}/{y}`)
    : basemap.url;
  return {
    kind: 'raster',
    id: `basemap-${basemap.id}`,
    url,
    auth: isProxiedTileUrl(url) ? 'cookie' : 'none',
    maxZoom: basemap.max_native_zoom ?? undefined,
    attribution: basemapAttribution(basemap.url),
  };
}

interface CustomMapLike {
  id: number;
  tile_url?: string | null;
  render_config: Parameters<typeof applyRenderOverride>[1];
  max_native_zoom?: number | null;
}

/** Null until the map's tiles are registered. */
export function customMapLayer(
  map: CustomMapLike,
  override: RenderOverride | undefined,
  opacity: number
): RasterLayerSpec | null {
  if (!map.tile_url) return null;
  return {
    kind: 'raster',
    id: `custom-map-${map.id}`,
    url: applyRenderOverride(map.tile_url, map.render_config, override),
    auth: 'cookie',
    opacity,
    maxZoom: map.max_native_zoom ?? undefined,
  };
}

interface VectorLayerLike {
  id: number;
  pmtiles_url: string;
  source_layer?: string | null;
  color: string;
}

/** Outlined in the layer's colour over a light fill of it, so the imagery
 *  underneath stays readable. */
export function vectorLayer(layer: VectorLayerLike, opacity = 1): VectorTileLayerSpec {
  return {
    kind: 'vector-tiles',
    id: `vector-${layer.id}`,
    url: layer.pmtiles_url,
    auth: 'none',
    opacity,
    sourceLayers: layer.source_layer ? [layer.source_layer] : undefined,
    style: {
      stroke: { color: layer.color, width: 1.5 },
      fill: { color: `${layer.color}33` },
    },
  };
}
