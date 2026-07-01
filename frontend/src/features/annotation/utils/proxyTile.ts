/**
 * Provider tiles that need an API key are fetched through the backend proxy, which holds the
 * key encrypted and attaches it server-side. The browser never sees the key. A template needs
 * proxying when it still carries an `{api_key}` placeholder; the proxy URL keeps the OL
 * `{z}/{x}/{y}` placeholders and points at our API (so it rides the tiler-cookie auth, like a
 * self-hosted tiler).
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

interface TileEntry {
  tile_url: string;
  visualization_name: string;
}

/** A template needs server-side key injection when it still has an `{api_key}` placeholder. */
export function needsKeyProxy(template: string): boolean {
  return template.includes('{api_key}');
}

/** Our backend tile-proxy URLs require the tiler cookie, exactly like self-hosted tilers. */
export function isProxiedTileUrl(url: string): boolean {
  return /\/imagery\/(?:basemaps|slices)\/[^/]+\/tiles\//.test(url);
}

export function basemapTileProxyUrl(campaignId: number, basemapId: number): string {
  return `${API_BASE}/api/${campaignId}/imagery/basemaps/${basemapId}/tiles/{z}/{x}/{y}`;
}

export function sliceTileProxyUrl(campaignId: number, sliceId: number, vizName: string): string {
  return `${API_BASE}/api/${campaignId}/imagery/slices/${sliceId}/tiles/${encodeURIComponent(
    vizName
  )}/{z}/{x}/{y}`;
}

/** Proxy URL for a slice tile entry when it needs a key, else the raw (direct) template. */
export function resolveSliceTileUrl(campaignId: number, sliceId: number, entry: TileEntry): string {
  return needsKeyProxy(entry.tile_url)
    ? sliceTileProxyUrl(campaignId, sliceId, entry.visualization_name)
    : entry.tile_url;
}

/** Proxy URL for a basemap when it needs a key, else the raw (direct) template. */
export function resolveBasemapUrl(
  campaignId: number,
  basemap: { id: number; url: string }
): string {
  return needsKeyProxy(basemap.url) ? basemapTileProxyUrl(campaignId, basemap.id) : basemap.url;
}
