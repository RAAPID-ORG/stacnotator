import type {
  BasemapOut,
  CampaignOutFull,
  CustomMapOut,
  ImageryCollectionOut,
  ImagerySliceOut,
  ImagerySourceOut,
  ImageryViewOut,
  TimeSeriesOut,
  VectorLayerOut,
  VisualizationTemplateOut,
} from '~/api/client';
import { DEFAULT_TIMESERIES_WINDOW_NAME } from '~/shared/utils/constants';
import { stampLegendOverride, type LegendOverride } from './renderConfig';

export type Bbox = [number, number, number, number];

export interface SliceAddress {
  sourceId: number;
  collectionId: number;
  sliceIndex: number;
  vizId: string;
}

/** Slices known to render nothing at the current location, keyed `<collection>:<slice>`. */
export type Empties = Record<string, true>;

export const emptyKey = (collectionId: number, sliceIndex: number): string =>
  `${collectionId}:${sliceIndex}`;

export interface OverlaySelection {
  id: number | null;
  visible: boolean;
}

/** What the maps draw, beyond the catalog itself. */
export interface ImageryNavState {
  address: SliceAddress | null;
  showBasemap: boolean;
  selectedBasemapId: string | null;
  overlay: OverlaySelection;
  overlayOpacity: number;
  vector: OverlaySelection;
  empties: Empties;
  crosshair: boolean;
  showAnnotations: boolean;
  viewSync: boolean;
}

/** The slice of nav state that is remembered per imagery view. The toggles are
 *  left out on purpose: they are app-wide, not per-view. */
export type ViewSnapshot = Pick<
  ImageryNavState,
  'address' | 'showBasemap' | 'selectedBasemapId' | 'overlay' | 'overlayOpacity' | 'vector'
>;

export function snapshotForView(state: ImageryNavState): ViewSnapshot {
  const { address, showBasemap, selectedBasemapId, overlay, overlayOpacity, vector } = state;
  return { address, showBasemap, selectedBasemapId, overlay, overlayOpacity, vector };
}

/** Indexed view over a campaign's imagery, built once per load so navigation
 *  and layer building never rescan the nested response. */
export interface Catalog {
  campaignId: number;
  sources: Map<number, ImagerySourceOut>;
  collections: Map<number, ImageryCollectionOut>;
  slices: Map<number, ImagerySliceOut>;
  vizzes: Map<number, VisualizationTemplateOut>;
  basemaps: Map<number, BasemapOut>;
  customMaps: Map<number, CustomMapOut>;
  vectorLayers: Map<number, VectorLayerOut>;
  sourceOf: Map<number, number>;
  bbox: Bbox;
}

export function buildCatalog(campaign: CampaignOutFull): Catalog {
  const sources = new Map<number, ImagerySourceOut>();
  const collections = new Map<number, ImageryCollectionOut>();
  const slices = new Map<number, ImagerySliceOut>();
  const vizzes = new Map<number, VisualizationTemplateOut>();
  const sourceOf = new Map<number, number>();

  for (const source of campaign.imagery_sources) {
    sources.set(source.id, source);
    for (const viz of source.visualizations) vizzes.set(viz.id, viz);
    for (const collection of source.collections) {
      collections.set(collection.id, collection);
      sourceOf.set(collection.id, source.id);
      for (const slice of collection.slices) slices.set(slice.id, slice);
    }
  }

  const { bbox_west, bbox_south, bbox_east, bbox_north } = campaign.settings;

  return {
    campaignId: campaign.id,
    sources,
    collections,
    slices,
    vizzes,
    basemaps: new Map(campaign.basemaps.map((b) => [b.id, b])),
    customMaps: new Map((campaign.custom_maps ?? []).map((m) => [m.id, m])),
    vectorLayers: new Map((campaign.vector_layers ?? []).map((l) => [l.id, l])),
    sourceOf,
    bbox: [bbox_west, bbox_south, bbox_east, bbox_north],
  };
}

/** Collections a view browses, in the view's source order then each source's own. */
export function collectionsInView(
  cat: Catalog,
  view: Pick<ImageryViewOut, 'source_ids'> | null
): ImageryCollectionOut[] {
  const out: ImageryCollectionOut[] = [];
  for (const sourceId of view?.source_ids ?? []) {
    const source = cat.sources.get(sourceId);
    if (source) out.push(...source.collections);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chronology. Collections arrive in insertion order, so historical imagery
// added later has to be sorted by its earliest slice wherever it is shown.
// ---------------------------------------------------------------------------

const UNDATED = '9999-99-99';

export function collectionStartDate(collection: { slices: { start_date?: string | null }[] }) {
  let earliest = '';
  for (const slice of collection.slices) {
    if (slice.start_date && (!earliest || slice.start_date < earliest)) earliest = slice.start_date;
  }
  return earliest || UNDATED;
}

export function byCollectionDate<
  T extends { collection?: { slices: { start_date?: string | null }[] } | null },
>(a: T, b: T): number {
  const first = a.collection ? collectionStartDate(a.collection) : UNDATED;
  const second = b.collection ? collectionStartDate(b.collection) : UNDATED;
  return first.localeCompare(second);
}

// ---------------------------------------------------------------------------
// Timeseries windows
// ---------------------------------------------------------------------------

export const TIMESERIES_KEY_PREFIX = 'timeseries:';
export { DEFAULT_TIMESERIES_WINDOW_NAME };

export interface TimeseriesWindow {
  key: string;
  title: string;
  series: TimeSeriesOut[];
}

export function groupTimeseriesIntoWindows(timeseries: TimeSeriesOut[]): TimeseriesWindow[] {
  const byKey = new Map<string, TimeseriesWindow>();
  for (const ts of timeseries) {
    const title = ts.window_name?.trim() || DEFAULT_TIMESERIES_WINDOW_NAME;
    const key = `${TIMESERIES_KEY_PREFIX}${title}`;
    let window = byKey.get(key);
    if (!window) {
      window = { key, title, series: [] };
      byKey.set(key, window);
    }
    window.series.push(ts);
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// Tile URLs. Provider tiles needing an API key go through the backend proxy,
// which holds the key encrypted and attaches it server-side.
// ---------------------------------------------------------------------------

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
  cat: Catalog,
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
