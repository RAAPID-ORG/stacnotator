import {
  campaignProxyBase,
  isProxiedTileUrl,
  needsKeyProxy,
  sliceProxyUrl,
} from '~/shared/imagery/tileUrls';
import { stampLegendOverride, type LegendOverride } from '~/shared/imagery/tileColors';
import type { ImageryCatalog } from './imagery';
import type { SliceAddress } from './imageryNav';

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
    auth: isProxiedTileUrl(url) ? 'cookie' : 'none',
    maxZoom: source.max_native_zoom ?? undefined,
  };
}
