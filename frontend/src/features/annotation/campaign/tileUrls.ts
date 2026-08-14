import type { ImageryCatalog } from './imagery';
import type { SliceAddress } from './imageryNav';
import { stampLegendOverride, type LegendOverride } from './renderConfig';

// Provider tiles needing an API key go through the backend proxy, which holds
// the key encrypted and attaches it server-side.
const needsKeyProxy = (template: string): boolean => template.includes('{api_key}');

/** Our proxy routes require the tiler cookie, exactly like self-hosted tilers. */
export function isProxiedTileUrl(url: string): boolean {
  return /\/imagery\/(?:basemaps|slices)\/[^/]+\/tiles\//.test(url);
}

export function resolveBasemapUrl(campaignId: number, basemap: { id: number; url: string }) {
  return needsKeyProxy(basemap.url)
    ? `/api/${campaignId}/imagery/basemaps/${basemap.id}/tiles/{z}/{x}/{y}`
    : basemap.url;
}

const ATTRIBUTIONS: Array<[string, string]> = [
  [
    'carto',
    '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  ],
  [
    'opentopomap',
    '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>) &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  ],
  [
    'arcgisonline',
    '&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Sources: Esri, Maxar, Earthstar Geographics',
  ],
  [
    'esri',
    '&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Sources: Esri, Maxar, Earthstar Geographics',
  ],
  [
    'openstreetmap',
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  ],
];

/** Credit line for the basemap providers we ship. An unrecognised provider
 *  gets none rather than a made-up one. */
export function basemapAttribution(url: string): string | undefined {
  const lower = url.toLowerCase();
  return ATTRIBUTIONS.find(([needle]) => lower.includes(needle))?.[1];
}

export interface SliceRaster {
  id: string;
  url: string;
  auth: 'cookie' | 'none';
}

/** Throws when the address names something the catalog no longer has - a
 *  collection deleted while a saved view snapshot still points at it. */
export function sliceRaster(
  cat: ImageryCatalog,
  addr: SliceAddress,
  override?: LegendOverride
): SliceRaster {
  const source = cat.sources.get(addr.sourceId);
  if (!source) throw new Error(`unknown source ${addr.sourceId}`);

  const collection = cat.collections.get(addr.collectionId);
  if (!collection) throw new Error(`unknown collection ${addr.collectionId}`);

  const slice = collection.slices[addr.sliceIndex];
  if (!slice) throw new Error(`no slice ${addr.sliceIndex} in collection ${addr.collectionId}`);

  const viz = cat.vizzes.get(Number(addr.vizId));
  if (!viz) throw new Error(`unknown visualization ${addr.vizId}`);

  const entry = slice.tile_urls.find((e) => e.visualization_name === viz.name);
  if (!entry) throw new Error(`no tile url for "${viz.name}" on slice ${slice.id}`);

  const raw = needsKeyProxy(entry.tile_url)
    ? `/api/${cat.campaignId}/imagery/slices/${slice.id}/tiles/${encodeURIComponent(viz.name)}/{z}/{x}/{y}`
    : entry.tile_url;
  const url = stampLegendOverride(raw, override);

  return {
    id: `slice-${slice.id}-${viz.id}`,
    url,
    auth: isProxiedTileUrl(url) ? 'cookie' : 'none',
  };
}
