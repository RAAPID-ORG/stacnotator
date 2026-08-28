import { apiUrl } from '~/api/base';

// Provider tiles needing an API key go through the backend proxy, which holds
// the key encrypted and attaches it server-side.
export const needsKeyProxy = (template: string): boolean => template.includes('{api_key}');

/** Our proxy routes require the tiler cookie, exactly like self-hosted tilers. */
export function isProxiedTileUrl(url: string): boolean {
  return /\/imagery\/(?:basemaps|slices)\/[^/]+\/tiles\//.test(url);
}

/** Where a key-protected basemap's tiles are fetched from: the provider
 *  directly, or our proxy when the template needs a key we hold. */
export function resolveBasemapUrl(campaignId: number, basemap: { id: number; url: string }) {
  return needsKeyProxy(basemap.url)
    ? apiUrl(`/api/${campaignId}/imagery/basemaps/${basemap.id}/tiles/{z}/{x}/{y}`)
    : basemap.url;
}

/** One slice's tiles under a named visualization, off the proxy route its
 *  owner is served from (a campaign's and a visualizer's differ). */
export function sliceProxyUrl(base: string, sliceId: number, vizName: string): string {
  return apiUrl(`${base}/${sliceId}/tiles/${encodeURIComponent(vizName)}/{z}/{x}/{y}`);
}

/** Where a campaign's key-proxied slice tiles are fetched from. */
export const campaignProxyBase = (campaignId: number) => `/api/${campaignId}/imagery/slices`;

/** The backdrop the app draws where no basemap is configured: the minimap, the
 *  Leaflet admin maps, and a visualizer that ships none of its own. OpenFreeMap
 *  serves this MapLibre style and its tiles without an API key, which CARTO's
 *  raster tiles no longer are. Attribution comes from the style's TileJSON. */
export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

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
