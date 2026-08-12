import type {
  BasemapOut,
  CampaignOutFull,
  CustomMapOut,
  ImageryCollectionOut,
  ImagerySliceOut,
  ImagerySourceOut,
  VectorLayerOut,
  VisualizationTemplateOut,
} from '~/api/client';
import type { LegendOverride } from './customMap';
import { stampLegendOverride } from './customMap';
import type { SliceAddress } from './types';

export type Bbox4326 = [number, number, number, number];

/** Indexed view over a campaign's imagery catalog: every lookup the
 *  navigation/cycling/layer-building functions need, built once per
 *  campaign load rather than re-scanned on every call. */
export interface Catalog {
  campaignId: number;
  sources: Map<number, ImagerySourceOut>;
  collections: Map<number, ImageryCollectionOut>;
  slices: Map<number, ImagerySliceOut>;
  vizzes: Map<number, VisualizationTemplateOut>;
  basemaps: Map<number, BasemapOut>;
  customMaps: Map<number, CustomMapOut>;
  vectorLayers: Map<number, VectorLayerOut>;
  /** Reverse lookup: a collection id back to the source that owns it. */
  sourceIdByCollectionId: Map<number, number>;
  bbox: Bbox4326;
}

export function buildCatalog(campaign: CampaignOutFull): Catalog {
  const sources = new Map<number, ImagerySourceOut>();
  const collections = new Map<number, ImageryCollectionOut>();
  const slices = new Map<number, ImagerySliceOut>();
  const vizzes = new Map<number, VisualizationTemplateOut>();
  const sourceIdByCollectionId = new Map<number, number>();

  for (const source of campaign.imagery_sources) {
    sources.set(source.id, source);
    for (const viz of source.visualizations) vizzes.set(viz.id, viz);
    for (const collection of source.collections) {
      collections.set(collection.id, collection);
      sourceIdByCollectionId.set(collection.id, source.id);
      for (const slice of collection.slices) slices.set(slice.id, slice);
    }
  }

  const basemaps = new Map(campaign.basemaps.map((b) => [b.id, b] as const));
  const customMaps = new Map((campaign.custom_maps ?? []).map((m) => [m.id, m] as const));
  const vectorLayers = new Map((campaign.vector_layers ?? []).map((l) => [l.id, l] as const));

  const { bbox_west, bbox_south, bbox_east, bbox_north } = campaign.settings;
  const bbox: Bbox4326 = [bbox_west, bbox_south, bbox_east, bbox_north];

  return {
    campaignId: campaign.id,
    sources,
    collections,
    slices,
    vizzes,
    basemaps,
    customMaps,
    vectorLayers,
    sourceIdByCollectionId,
    bbox,
  };
}

// ---------------------------------------------------------------------------
// Proxy tile url assembly. Provider tiles that need an API key are fetched
// through the backend proxy, which holds
// the key encrypted and attaches it server-side; the proxy path keeps the
// `{z}/{x}/{y}` placeholders and rides the tiler-cookie auth. Callers that
// need an absolute URL (a configured API base) prefix these relative paths
// themselves - that's an app/platform concern, not domain's.
// ---------------------------------------------------------------------------

/** A template needs server-side key injection when it still has an
 *  `{api_key}` placeholder. */
export function needsKeyProxy(template: string): boolean {
  return template.includes('{api_key}');
}

/** Our backend tile-proxy URLs require the tiler cookie, exactly like
 *  self-hosted tilers. */
export function isProxiedTileUrl(url: string): boolean {
  return /\/imagery\/(?:basemaps|slices)\/[^/]+\/tiles\//.test(url);
}

export function basemapTileProxyUrl(campaignId: number, basemapId: number): string {
  return `/api/${campaignId}/imagery/basemaps/${basemapId}/tiles/{z}/{x}/{y}`;
}

export function sliceTileProxyUrl(campaignId: number, sliceId: number, vizName: string): string {
  return `/api/${campaignId}/imagery/slices/${sliceId}/tiles/${encodeURIComponent(vizName)}/{z}/{x}/{y}`;
}

export function resolveBasemapUrl(
  campaignId: number,
  basemap: { id: number; url: string }
): string {
  return needsKeyProxy(basemap.url) ? basemapTileProxyUrl(campaignId, basemap.id) : basemap.url;
}

// ---------------------------------------------------------------------------
// Layer spec assembly
// ---------------------------------------------------------------------------

/** Credit line for the basemap providers we ship, keyed off the tile URL.
 *  A provider we do not recognise gets none rather than a made-up one. */
export function basemapAttribution(url: string): string | undefined {
  const u = url.toLowerCase();
  if (u.includes('carto'))
    return '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  if (u.includes('opentopomap'))
    return '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>) &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  if (u.includes('arcgisonline') || u.includes('esri'))
    return '&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Sources: Esri, Maxar, Earthstar Geographics';
  if (u.includes('openstreetmap'))
    return '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  return undefined;
}

export interface RasterLayerLike {
  kind: 'raster';
  id: string;
  url: string;
  auth?: 'cookie' | 'none';
  opacity?: number;
  attribution?: string;
}

/** Single home for building a slice's raster layer: resolves the tile url
 *  template, rewrites it through the key proxy when needed, and stamps any
 *  legend override onto the query params. */
export function layerSpecFor(
  cat: Catalog,
  addr: SliceAddress,
  overrides?: LegendOverride
): RasterLayerLike {
  const source = cat.sources.get(addr.sourceId);
  if (!source) throw new Error(`layerSpecFor: unknown source ${addr.sourceId}`);

  const collection = cat.collections.get(addr.collectionId);
  if (!collection) throw new Error(`layerSpecFor: unknown collection ${addr.collectionId}`);

  const slice = collection.slices[addr.sliceIndex];
  if (!slice) {
    throw new Error(
      `layerSpecFor: no slice at index ${addr.sliceIndex} in collection ${addr.collectionId}`
    );
  }

  const viz = cat.vizzes.get(Number(addr.vizId));
  if (!viz) throw new Error(`layerSpecFor: unknown visualization ${addr.vizId}`);

  const entry = slice.tile_urls.find((e) => e.visualization_name === viz.name);
  if (!entry) {
    throw new Error(
      `layerSpecFor: no tile url for visualization "${viz.name}" on slice ${slice.id}`
    );
  }

  const rawUrl = needsKeyProxy(entry.tile_url)
    ? sliceTileProxyUrl(cat.campaignId, slice.id, viz.name)
    : entry.tile_url;
  const url = stampLegendOverride(rawUrl, overrides);

  return {
    kind: 'raster',
    id: `slice-${slice.id}-${viz.id}`,
    url,
    auth: isProxiedTileUrl(url) ? 'cookie' : 'none',
  };
}
