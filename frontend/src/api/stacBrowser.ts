/**
 * Thin wrappers around generated SDK calls for the STAC browser endpoints.
 * Keeps local type definitions for responses the backend returns untyped.
 */

import {
  listCatalogs as _listCatalogs,
  getCollections as _getCollections,
  search as _search,
} from './client';
import type { StacItemOut, AssetInfo } from './client';

// Re-export generated types under the names consumers already use
export type StacItem = StacItemOut;
export type StacAssetInfo = AssetInfo;

// These response shapes aren't typed in the OpenAPI spec (backend returns raw dicts),
// so we keep local definitions.
export interface StacCatalog {
  id: string;
  title: string;
  url: string;
  summary: string;
  is_mpc: boolean;
  auth_required: boolean;
}

export interface StacCollection {
  id: string;
  title: string;
  description: string;
  temporal_extent?: { start: string | null; end: string | null } | null;
  spatial_extent?: number[] | null;
  keywords: string[];
  item_assets?: Record<string, StacAssetInfo>;
  has_cloud_cover?: boolean;
}

export async function fetchCatalogs(): Promise<StacCatalog[]> {
  const { data, error } = await _listCatalogs();
  if (error) throw new Error('Failed to fetch catalogs');
  return data as StacCatalog[];
}

export async function fetchCollections(catalogUrl: string): Promise<StacCollection[]> {
  const { data, error } = await _getCollections({
    query: { catalog_url: catalogUrl },
  });
  if (error) {
    const detail =
      (error as { detail?: unknown })?.detail ??
      (typeof error === 'string' ? error : JSON.stringify(error));
    throw new Error(`Failed to fetch collections: ${detail}`);
  }
  return data as StacCollection[];
}

export async function searchItems(params: {
  catalog_url: string;
  collection_id: string;
  bbox?: number[];
  datetime_range?: string;
  limit?: number;
}): Promise<{ items: StacItem[]; count: number }> {
  const { data, error } = await _search({
    body: {
      catalog_url: params.catalog_url,
      collection_id: params.collection_id,
      bbox: params.bbox ?? null,
      datetime_range: params.datetime_range ?? null,
      limit: params.limit,
    },
  });
  if (error) throw new Error('Search failed');
  return data!;
}
