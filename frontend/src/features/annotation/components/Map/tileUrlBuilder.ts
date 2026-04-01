/**
 * Dynamic tile URL construction for different tile providers.
 *
 * - null / undefined tile_provider: use tile_url as-is (backward compat with existing MPC pre-resolved URLs)
 * - 'self_hosted': build URL against embedded TiTiler endpoints
 * - 'mpc': MPC tile URL with viz params appended
 */

const BACKEND_BASE = import.meta.env.VITE_API_BASE_URL || '';

export interface VizParams {
  assets?: string[];
  assetAsBand?: boolean;
  rescale?: string;
  colormapName?: string;
  colorFormula?: string;
  expression?: string;
  resampling?: string;
}

export interface TileUrlEntry {
  tile_url: string;
  tile_provider?: string | null;
}

export function buildTileUrl(tileUrl: TileUrlEntry, vizParams?: VizParams | null): string {
  // Backward compat: no tile_provider → use URL as-is
  if (!tileUrl.tile_provider) return tileUrl.tile_url;

  if (tileUrl.tile_provider === 'self_hosted') {
    // tile_url is a base path like /stac/tiles/... or /api/stac/mosaic/{id}/tiles/...
    // Append viz query params
    const params = buildVizQueryParams(vizParams);
    const separator = tileUrl.tile_url.includes('?') ? '&' : '?';
    return `${BACKEND_BASE}${tileUrl.tile_url}${params ? separator + params : ''}`;
  }

  if (tileUrl.tile_provider === 'mpc') {
    // MPC URL - can optionally append/override viz params
    if (!vizParams) return tileUrl.tile_url;
    return appendVizParams(tileUrl.tile_url, vizParams);
  }

  return tileUrl.tile_url;
}

function buildVizQueryParams(vizParams?: VizParams | null): string {
  if (!vizParams) return '';
  const params = new URLSearchParams();

  if (vizParams.expression) {
    params.set('expression', vizParams.expression);
  }

  if (vizParams.assets) {
    vizParams.assets.forEach((a) => params.append('assets', a));
    if (vizParams.assets.length === 3 && vizParams.assetAsBand) {
      params.set('asset_as_band', 'true');
    }
  }

  if (vizParams.rescale) {
    // Apply same rescale to each band
    const numBands = vizParams.assets?.length || 1;
    for (let i = 0; i < numBands; i++) {
      params.append('rescale', vizParams.rescale);
    }
  }

  if (vizParams.colormapName && (!vizParams.assets || vizParams.assets.length === 1)) {
    params.set('colormap_name', vizParams.colormapName);
  }

  if (vizParams.colorFormula) {
    params.set('color_formula', vizParams.colorFormula);
  }

  if (vizParams.resampling) {
    params.set('resampling', vizParams.resampling);
  }

  return params.toString();
}

function appendVizParams(baseUrl: string, vizParams: VizParams): string {
  const extra = buildVizQueryParams(vizParams);
  if (!extra) return baseUrl;
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}${extra}`;
}
