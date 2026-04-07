/**
 * API hooks for the STAC browser endpoints.
 * The backend proxies STAC Index and individual STAC APIs (CORS requirement).
 */

import { getTilerToken } from './tilerToken';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const TILER_BASE = import.meta.env.VITE_TILER_BASE_URL || API_BASE;

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

export interface StacAssetInfo {
  title: string;
  type: string;
  roles: string[];
}

export interface StacItem {
  id: string;
  datetime: string | null;
  bbox: number[] | null;
  geometry: unknown;
  properties: Record<string, unknown>;
  assets: Record<string, StacAssetInfo>;
  thumbnail: string | null;
  self_href: string | null;
}

export async function fetchCatalogs(): Promise<StacCatalog[]> {
  const resp = await fetch(`${API_BASE}/api/stac/catalogs`);
  if (!resp.ok) throw new Error(`Failed to fetch catalogs: ${resp.status}`);
  return resp.json();
}

export async function fetchCollections(catalogUrl: string): Promise<StacCollection[]> {
  const resp = await fetch(
    `${API_BASE}/api/stac/collections?catalog_url=${encodeURIComponent(catalogUrl)}`
  );
  if (!resp.ok) throw new Error(`Failed to fetch collections: ${resp.status}`);
  return resp.json();
}

export async function searchItems(params: {
  catalog_url: string;
  collection_id: string;
  bbox?: number[];
  datetime_range?: string;
  limit?: number;
}): Promise<{ items: StacItem[]; count: number }> {
  const resp = await fetch(`${API_BASE}/api/stac/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
  return resp.json();
}

export async function createMosaic(params: {
  catalog_url: string;
  collection_id: string;
  bbox: number[];
  datetime_range: string;
  pixel_selection?: string;
}): Promise<{
  mosaic_id: string;
  item_count: number;
  assets: Record<string, StacAssetInfo>;
}> {
  const resp = await fetch(`${API_BASE}/api/stac/mosaic/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!resp.ok) throw new Error(`Mosaic creation failed: ${resp.status}`);
  return resp.json();
}

export async function fetchStats(params: {
  catalog_url: string;
  collection_id: string;
  assets: string[];
  bbox?: number[];
  datetime_range?: string;
  max_cloud_cover?: number;
}): Promise<{ rescale: string; source: string }> {
  const tilerToken = await getTilerToken();
  const resp = await fetch(`${TILER_BASE}/api/stac/stats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tilerToken}` },
    body: JSON.stringify(params),
  });
  if (!resp.ok) throw new Error(`Stats request failed: ${resp.status}`);
  return resp.json();
}
