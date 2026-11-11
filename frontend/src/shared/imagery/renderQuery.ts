import type { RenderParams } from '~/api/client';

// Mirrors the backend's build_viz_query_string (src/tilers/providers.py), so a tile
// URL drawn with edited parameters matches the one the server would derive.
function renderQuery(params: RenderParams, forMpc: boolean): URLSearchParams {
  const parts = new URLSearchParams();
  const assets = params.assets ?? [];
  for (const asset of assets) parts.append('assets', asset);
  if (params.asset_as_band) parts.append('asset_as_band', 'true');
  for (const [key, value] of Object.entries(params.extra_params ?? {})) {
    parts.append(key, String(value));
  }
  const expression = params.expression;
  if (expression) parts.append('expression', expression);

  const bidx = (params.bidx ?? []).map(Number);
  const outputBands = expression
    ? expression.split(',').filter((term) => term.trim()).length || 1
    : bidx.length || Math.max(assets.length, 1);

  if (params.rescale) {
    for (let i = 0; i < outputBands; i++) parts.append('rescale', params.rescale);
  }
  if (params.colormap_name && outputBands === 1) {
    parts.append('colormap_name', params.colormap_name);
  }
  if (params.color_formula) parts.append('color_formula', params.color_formula);
  if (params.resampling) parts.append('resampling', params.resampling);
  if (params.nodata != null) parts.append('nodata', String(params.nodata));
  if (forMpc) return parts;

  if (bidx.length) parts.append('bidx', bidx.join(','));
  if (params.compositing) parts.append('compositing', params.compositing);
  if (params.mask_layer) parts.append('mask_layer', params.mask_layer);
  for (const value of params.mask_values ?? []) parts.append('mask_values', String(value));
  if (params.nir_band) parts.append('nir_band', params.nir_band);
  if (params.red_band) parts.append('red_band', params.red_band);
  if (params.max_items != null) {
    parts.append('max_items', String(Math.max(1, Math.min(Math.trunc(params.max_items), 10))));
  }
  return parts;
}

/** A tile URL template with its query rewritten. The path, with its `{z}/{x}/{y}`
 *  placeholders, is spliced as text rather than through `new URL`, which would
 *  percent-encode them and stop OpenLayers substituting them. */
export function withTileQuery(
  url: string,
  rewrite: (query: URLSearchParams) => URLSearchParams
): string {
  const qIdx = url.indexOf('?');
  const path = qIdx === -1 ? url : url.slice(0, qIdx);
  const query = rewrite(new URLSearchParams(qIdx === -1 ? '' : url.slice(qIdx + 1))).toString();
  return query ? `${path}?${query}` : path;
}

// What MPC's tile URL carries ahead of the render parameters (see build_tile_url).
const MPC_KEPT = ['collection', 'pixel_selection'];

/** A server-derived STAC tile URL drawn with other parameters. */
export function restampTileUrl(
  url: string,
  tiler: string | null | undefined,
  params: RenderParams
): string {
  const forMpc = tiler === 'mpc';
  return withTileQuery(url, (original) => {
    const query = new URLSearchParams();
    for (const key of forMpc ? MPC_KEPT : []) {
      const value = original.get(key);
      if (value != null) query.append(key, value);
    }
    for (const [key, value] of renderQuery(params, forMpc)) query.append(key, value);
    return query;
  });
}
