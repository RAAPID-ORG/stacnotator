/**
 * Layer definitions for the main imagery window.
 *
 * Two kinds of layers exist:
 *  - XYZLayer  – standard tile layers (ESRI, TopoMap, Carto, …)
 *  - StacLayer – TiTiler-backed layers that require a STAC search registration
 *                before tiles are available. Registration is handled lazily and
 *                the resulting searchId is kept in a module-level cache so each
 *                unique (registrationUrl + searchBody) combination is only ever
 *                registered once per page session.
 */

import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LayerKind = 'xyz' | 'stac';

interface BaseLayerDef {
  id: string;
  name: string;
  kind: LayerKind;
}

export interface XYZLayerDef extends BaseLayerDef {
  kind: 'xyz';
  urlTemplate: string;
  attribution?: string;
}

export interface StacLayerDef extends BaseLayerDef {
  kind: 'stac';
  /** POST endpoint that registers the search and returns a searchId */
  registrationUrl: string;
  /** Body for the registration POST request */
  searchBody: Record<string, unknown>;
  /**
   * Tile URL template with {z}/{x}/{y} and {searchId} placeholders.
   * e.g. "https://titiler.example.com/searches/{searchId}/tiles/{z}/{x}/{y}"
   */
  visualizationUrlTemplate: string;
  attribution?: string;
}

export type LayerDef = XYZLayerDef | StacLayerDef;

// ---------------------------------------------------------------------------
// Well-known XYZ base layers
// ---------------------------------------------------------------------------

export const BUILTIN_XYZ_LAYERS: XYZLayerDef[] = [
  {
    id: 'esri-world-imagery',
    name: 'ESRI World Imagery',
    kind: 'xyz',
    urlTemplate:
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © Esri',
  },
  {
    id: 'opentopomap',
    name: 'OpenTopoMap',
    kind: 'xyz',
    urlTemplate: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenTopoMap contributors',
  },
  {
    id: 'carto-light',
    name: 'Carto Light',
    kind: 'xyz',
    urlTemplate:
      'https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors © CARTO',
  },
];

// ---------------------------------------------------------------------------
// STAC search-id cache
//
// Key   = `${registrationUrl}::${JSON.stringify(searchBody)}`
// Value = resolved searchId string (or in-flight promise to avoid duplicate requests)
// ---------------------------------------------------------------------------

const stacSearchIdCache = new Map<string, Promise<string>>();

function stacCacheKey(registrationUrl: string, searchBody: Record<string, unknown>): string {
  return `${registrationUrl}::${JSON.stringify(searchBody)}`;
}

/**
 * Registers a STAC search (POST to registrationUrl) and returns the searchId.
 * Repeated calls with the same arguments return the cached promise immediately.
 */
export async function resolveStacSearchId(
  registrationUrl: string,
  searchBody: Record<string, unknown>,
): Promise<string> {
  const key = stacCacheKey(registrationUrl, searchBody);

  if (!stacSearchIdCache.has(key)) {
    const promise = fetch(registrationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(searchBody),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`STAC registration failed: ${res.status} ${res.statusText}`);
        const json = await res.json();
        // TiTiler returns { id: "<searchId>" } or similar variations
        const searchId: string =
          json.id ?? json.searchId ?? json.searchid ?? json.search_id;
        if (!searchId) throw new Error('STAC registration response did not contain a searchId');
        return searchId;
      })
      .catch((err) => {
        // Remove from cache so the next call can retry
        stacSearchIdCache.delete(key);
        throw err;
      });

    stacSearchIdCache.set(key, promise);
  }

  return stacSearchIdCache.get(key)!;
}

// ---------------------------------------------------------------------------
// OL TileLayer factory
// ---------------------------------------------------------------------------

/**
 * Creates an OpenLayers TileLayer for an XYZ layer definition.
 * The layer is initially invisible; the map store controls visibility.
 */
export function createXYZTileLayer(def: XYZLayerDef): TileLayer<XYZ> {
  return new TileLayer({
    visible: false,
    preload: Infinity,
    source: new XYZ({
      url: def.urlTemplate,
      attributions: def.attribution,
    }),
    properties: { layerId: def.id },
  });
}

/**
 * Creates an OpenLayers TileLayer for a STAC layer definition.
 * The layer is invisible until `activateStacLayer` resolves the searchId and
 * updates the source URL.
 */
export function createStacTileLayer(def: StacLayerDef): TileLayer<XYZ> {
  return new TileLayer({
    visible: false,
    preload: Infinity,
    // Start with an empty source; URL is filled in once registration resolves
    source: new XYZ({ url: '' }),
    properties: { layerId: def.id },
  });
}

/**
 * Registers a STAC search (cached) and patches the tile URL on the provided layer.
 * Safe to call multiple times – subsequent calls resolve from cache.
 */
export async function activateStacLayer(
  layer: TileLayer<XYZ>,
  def: StacLayerDef,
): Promise<void> {
  const searchId = await resolveStacSearchId(def.registrationUrl, def.searchBody);
  const tileUrl = def.visualizationUrlTemplate.replace('{searchId}', searchId);
  const source = layer.getSource();
  if (source) {
    (source as XYZ).setUrl(tileUrl);
  }
}
