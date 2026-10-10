import {
  campaignProxyBase,
  isProxiedTileUrl,
  isSelfHostedTiler,
  needsKeyProxy,
  sliceProxyUrl,
} from '~/shared/imagery/tileUrls';
import { stampLegendOverride, type LegendOverride } from '~/shared/imagery/tileColors';
import type { ImageryCatalog } from './imagery';
import type { SliceAddress } from './imageryNav';

export function sliceLegend(
  cat: ImageryCatalog,
  address: SliceAddress | null,
  override?: LegendOverride
): { name: string; colormap: string; range: [number, number] | null } | null {
  if (!address) return null;
  const collection = cat.collections.get(address.collectionId);
  const viz = cat.vizzes.get(Number(address.vizId));
  if (!collection || !viz) return null;
  const config = collection.stac_config?.viz_configs?.find((entry) => entry.name === viz.name);
  const render =
    collection.has_dedicated_cover && address.sliceIndex === collection.cover_slice_index
      ? (config?.cover_render_params ?? config?.render_params)
      : config?.render_params;
  const tile = collection.slices[address.sliceIndex]?.tile_urls.find(
    (entry) => entry.visualization_name === viz.name
  );
  const query = new URLSearchParams(tile?.tile_url.split('?')[1] ?? '');
  const expression = render?.expression ?? query.get('expression');
  const extra = render?.extra_params;
  const assetBands =
    (extra && typeof extra === 'object' && 'asset_bidx' in extra ? extra.asset_bidx : null) ??
    query.get('asset_bidx');
  const bands =
    render?.bidx ??
    (query.has('bidx')
      ? query.getAll('bidx')
      : typeof assetBands === 'string'
        ? assetBands.split('|')[1]?.split(',')
        : []);
  const assets = render?.assets ?? query.getAll('assets');
  const colormap = render?.colormap_name ?? query.get('colormap_name');
  const rescale = render?.rescale ?? query.get('rescale');
  const hasRange = typeof rescale === 'string' && rescale.trim() !== '';
  const singleBand = expression
    ? typeof expression === 'string' && expression.split(';').length === 1
    : Array.isArray(bands) && bands.length
      ? bands.length === 1
      : !!colormap ||
        ((render?.asset_as_band === true ||
          query.get('asset_as_band') === 'true' ||
          (hasRange && !(render?.color_formula ?? query.get('color_formula')))) &&
          Array.isArray(assets) &&
          assets.length === 1);
  if (!singleBand) return null;
  const effectiveRange = override?.rescale ?? rescale;
  const values =
    typeof effectiveRange === 'string'
      ? effectiveRange.split(',').map((value) => (value.trim() ? Number(value) : NaN))
      : effectiveRange;
  const range: [number, number] | null =
    Array.isArray(values) &&
    values.length === 2 &&
    values.every((value) => typeof value === 'number' && Number.isFinite(value))
      ? [values[0], values[1]]
      : null;
  return {
    name: viz.name,
    colormap: override?.colormap_name ?? (typeof colormap === 'string' ? colormap : ''),
    range,
  };
}

export function awaitingImageryRegistration(
  status: string | undefined,
  cat: ImageryCatalog,
  address: SliceAddress | null
): boolean {
  if (status !== 'registering') return false;
  if (!address) return true;
  const slice = cat.collections.get(address.collectionId)?.slices[address.sliceIndex];
  const viz = cat.vizzes.get(Number(address.vizId));
  return !slice?.tile_urls.some((entry) => entry.visualization_name === viz?.name);
}

export interface SliceRaster {
  id: string;
  url: string;
  auth: 'cookie' | 'none';
  /** The source's native zoom cap, when it declares one. */
  maxZoom?: number;
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
    ? sliceProxyUrl(campaignProxyBase(cat.campaignId), slice.id, viz.name)
    : entry.tile_url;
  const url = stampLegendOverride(raw, override);

  return {
    id: `slice-${slice.id}-${viz.id}`,
    url,
    auth: isProxiedTileUrl(url) || isSelfHostedTiler(entry.tile_provider) ? 'cookie' : 'none',
    maxZoom: source.max_native_zoom ?? undefined,
  };
}
