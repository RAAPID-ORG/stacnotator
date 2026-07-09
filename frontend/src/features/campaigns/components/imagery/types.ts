export interface VisualizationOption {
  name: string;
}

export interface VisualizationUrl {
  vizName: string;
  url: string;
}

export interface ImagerySlice {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  /** Per-slice visualization URLs (used by manual XYZ collections) */
  vizUrls?: VisualizationUrl[];
}

export interface ManualCollectionData {
  type: 'manual';
  vizUrls: VisualizationUrl[];
}

export interface VizParams {
  assets: string[];
  assetAsBand: boolean;
  rescale: string;
  colormapName?: string;
  colorFormula?: string;
  expression?: string;
  /** 1-based band indexes to output from a single multiband asset (e.g. [6,4,2] for R,G,B).
   *  Used when the collection exposes one asset with multiple eo:bands; the tiler slices
   *  the read result to these bands. Mutually exclusive with multi-asset selection. */
  bidx?: number[];
  resampling?: string;
  compositing?: string;
  nodata?: number;
  /** Extra query parameters passed through to the tiler (e.g. asset_bidx, post_process) */
  extraParams?: Record<string, string>;
  /** Asset name to use as pixel mask (e.g. "SCL" for Sentinel-2 Scene Classification) */
  maskLayer?: string;
  /** Values in mask layer to exclude (e.g. [0, 1, 8, 9, 10] to mask clouds/nodata in SCL) */
  maskValues?: number[];
  nirBand?: string;
  redBand?: string;
  /** Max items per tile for compositing (1-10, default 5) */
  maxItems?: number;
}

export interface NamedVizParams {
  name: string;
  vizParams: VizParams;
}

export const ITEM_SORT_OPTIONS = ['date_desc', 'date_asc', 'cloud_cover_asc'] as const;
export type ItemSortOption = (typeof ITEM_SORT_OPTIONS)[number];
export const isItemSortOption = (v: string): v is ItemSortOption =>
  (ITEM_SORT_OPTIONS as readonly string[]).includes(v);

export interface StacBrowserCollectionData {
  type: 'stac_browser';
  catalogUrl: string;
  stacCollectionId: string;
  isMpc: boolean;
  /** Hosted tiler name to register/render on (null/undefined => default tiler). Non-MPC only. */
  tiler?: string | null;
  mode: 'single-item' | 'mosaic';
  itemHref?: string;
  mosaicId?: string;
  /** Max cloud cover percentage (0-100) for STAC search filtering */
  maxCloudCover?: number;
  /** How to sort items in the mosaic (affects which pixel wins in first-valid compositing) */
  itemSort?: ItemSortOption;
  /** Named visualizations - each defines a rendering config (bands, colormap, etc.) */
  visualizations: NamedVizParams[];
  /** When set, the cover slice uses these visualization params instead of the regular ones (e.g. different compositing) */
  coverVisualizations?: NamedVizParams[];
  /** Max cloud cover for cover slice (null/undefined = same as regular) */
  coverMaxCloudCover?: number;
  /** Item sort for cover slice (null/undefined = same as regular) */
  coverItemSort?: ItemSortOption;
  /** Custom CQL2-JSON search query (null/undefined = auto-generated from UI fields) */
  searchQuery?: Record<string, unknown>;
  /** Custom search query for cover slice (null/undefined = same as regular) */
  coverSearchQuery?: Record<string, unknown>;
  /** Assets are in internal storage the tiler reads with its managed identity (internal users only). */
  internalStorage?: boolean;
  vizUrls: VisualizationUrl[];
}

export interface CollectionItem {
  id: string;
  name: string;
  slices: ImagerySlice[];
  /** Index into slices[] of the slice shown first. Defaults to 0. Meaningful in both cover modes. */
  coverSliceIndex: number;
  /** True when the slice at coverSliceIndex is an out-of-band dedicated cover with override viz params / search query. */
  hasDedicatedCover: boolean;
  data: ManualCollectionData | StacBrowserCollectionData;
  /** Temporal window grouping interval (maps to ImageryCreate.window_interval) */
  windowInterval?: number | null;
  /** Temporal window grouping unit (maps to ImageryCreate.window_unit) */
  windowUnit?: string | null;
  /** Slice interval within each window (maps to ImageryCreate.slicing_interval) */
  slicingInterval?: number | null;
  /** Slice unit within each window (maps to ImageryCreate.slicing_unit) */
  slicingUnit?: string | null;
}

export interface ImagerySource {
  id: string;
  name: string;
  crosshairHex6: string;
  defaultZoom: number;
  visualizations: VisualizationOption[];
  collections: CollectionItem[];
  /** Whether a provider API key is configured server-side (persisted sources only). */
  hasApiKey?: boolean;
}

export interface ViewCollectionRef {
  collectionId: string;
  sourceId: string;
  showAsWindow: boolean;
}

export interface ImageryView {
  id: string;
  name: string;
  collectionRefs: ViewCollectionRef[];
}

export interface Basemap {
  id: string;
  name: string;
  url: string;
  /** Deepest zoom the provider actually serves. Past this, OL upscales the deepest tile instead of fetching "no data". Undefined = no cap. */
  maxNativeZoom?: number;
  /** Whether a provider API key is configured server-side (persisted basemaps only). */
  hasApiKey?: boolean;
}

export interface ImageryStepState {
  sources: ImagerySource[];
  views: ImageryView[];
  basemaps: Basemap[];
}

export const createId = (): string => crypto.randomUUID().slice(0, 8);

export const emptyVizParams = (): VizParams => ({
  assets: [],
  assetAsBand: false,
  rescale: '',
});

export const emptySlice = (): ImagerySlice => ({
  id: createId(),
  name: '',
  startDate: '',
  endDate: '',
});

export const emptySource = (): ImagerySource => ({
  id: createId(),
  name: '',
  crosshairHex6: 'ff0000',
  defaultZoom: 15,
  visualizations: [{ name: 'True Color' }],
  collections: [],
});

export const emptyManualCollection = (vizNames: string[]): CollectionItem => ({
  id: createId(),
  name: 'Untitled',
  slices: [emptySlice()],
  coverSliceIndex: 0,
  hasDedicatedCover: false,
  data: {
    type: 'manual',
    vizUrls: vizNames.map((name) => ({ vizName: name, url: '' })),
  },
});

export const emptyView = (): ImageryView => ({
  id: createId(),
  name: '',
  collectionRefs: [],
});

export const emptyBasemap = (): Basemap => ({
  id: createId(),
  name: '',
  url: '',
});

/** Default basemaps matching the annotation view */
export const DEFAULT_BASEMAPS: Basemap[] = [
  {
    id: 'carto-light',
    name: 'CartoDB Light',
    url: 'https://{a-c}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    maxNativeZoom: 20,
  },
  {
    id: 'esri-world-imagery',
    name: 'ESRI World Imagery',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    // Rural AOIs (Ukraine, much of Africa) only have real imagery up to
    // z18; z19+ returns Esri's "no data" placeholder. Urban AOIs can dial
    // this higher per-campaign in the basemap editor.
    maxNativeZoom: 18,
  },
  {
    id: 'opentopomap',
    name: 'OpenTopoMap',
    url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
    maxNativeZoom: 17,
  },
  {
    id: 'bing-aerial',
    name: 'Bing Aerial',
    // Bing uses quadkeys; the {q} placeholder is converted at tile-load time.
    url: 'http://ecn.t3.tiles.virtualearth.net/tiles/a{q}.jpeg?g=1',
    maxNativeZoom: 19,
  },
];

export function resolveCollection(
  sources: ImagerySource[],
  ref: ViewCollectionRef
): { source: ImagerySource; collection: CollectionItem } | null {
  const source = sources.find((s) => s.id === ref.sourceId);
  if (!source) return null;
  const collection = source.collections.find((c) => c.id === ref.collectionId);
  if (!collection) return null;
  return { source, collection };
}

export function swap<T>(arr: T[], i: number, j: number): T[] {
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return arr;
  const copy = [...arr];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

/** Date-range summary string for a collection's slices */
export function sliceDateRange(slices: ImagerySlice[]): string {
  if (slices.length === 0) return 'No slices';
  const sorted = [...slices].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const first = sorted[0].startDate;
  const last = sorted[sorted.length - 1].endDate;
  if (!first || !last) return `${slices.length} slice${slices.length !== 1 ? 's' : ''}`;
  return `${first} - ${last}`;
}
