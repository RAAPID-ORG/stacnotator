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

export interface StacCollectionData {
  type: 'stac';
  registrationUrl: string;
  searchBody: string;
  vizUrls: VisualizationUrl[];
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

export type ItemSortOption = 'date_desc' | 'date_asc' | 'cloud_cover_asc';

export interface StacBrowserCollectionData {
  type: 'stac_browser';
  catalogUrl: string;
  stacCollectionId: string;
  isMpc: boolean;
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
  vizUrls: VisualizationUrl[];
}

export interface CollectionItem {
  id: string;
  name: string;
  slices: ImagerySlice[];
  /** Index into slices[] that serves as the "cover" / representative image (e.g. a median mosaic). Defaults to 0. */
  coverSliceIndex: number;
  data: StacCollectionData | ManualCollectionData | StacBrowserCollectionData;
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
}

export interface ImageryStepState {
  sources: ImagerySource[];
  views: ImageryView[];
  basemaps: Basemap[];
}

export interface StacConfig {
  registrationUrl: string;
  searchBody: string;
  /** How often to create a new collection (outer grouping) */
  collectionPeriodInterval: number;
  collectionPeriodUnit: 'weeks' | 'months' | 'years';
  /** How to slice each collection into temporal slices (inner) */
  slicePeriodInterval: number;
  slicePeriodUnit: 'days' | 'weeks' | 'months' | 'years';
  startDate: string;
  endDate: string;
  vizUrls: VisualizationUrl[];
  /** Whether to generate a cover slice per collection (e.g. a median mosaic spanning the full collection period) */
  generateCoverSlice: boolean;
  /** How the cover slice is determined: 'nth' picks the Nth regular slice, 'custom' adds a separate cover slice with its own layer config */
  coverSliceMode: 'nth' | 'custom';
  /** When coverSliceMode='nth', which slice index (1-based) to use as the cover */
  coverSliceNth: number;
  /** Optional name for the cover slice */
  coverSliceName: string;
  /** Maximum cloud cover percentage (0-100). Used in the search body eo:cloud_cover filter. */
  cloudCover: number;
  /** Optional separate registration URL for the cover slice (falls back to registrationUrl if empty) */
  coverRegistrationUrl: string;
  /** Optional separate search body JSON for the cover slice (falls back to searchBody if empty) */
  coverSearchBody: string;
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
  data: {
    type: 'manual',
    vizUrls: vizNames.map((name) => ({ vizName: name, url: '' })),
  },
});

export const emptyStacCollection = (vizNames: string[]): CollectionItem => ({
  id: createId(),
  name: 'Untitled',
  slices: [],
  coverSliceIndex: 0,
  data: {
    type: 'stac',
    registrationUrl: '',
    searchBody: '',
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
  },
  {
    id: 'esri-world-imagery',
    name: 'ESRI World Imagery',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  },
  {
    id: 'opentopomap',
    name: 'OpenTopoMap',
    url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
  },
];

export const emptyStacConfig = (vizNames: string[]): StacConfig => {
  const year = new Date().getFullYear();
  return {
    registrationUrl: 'https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register',
    searchBody: '',
    collectionPeriodInterval: 1,
    collectionPeriodUnit: 'months',
    slicePeriodInterval: 1,
    slicePeriodUnit: 'weeks',
    startDate: `${year}-01`,
    endDate: `${year}-12`,
    vizUrls: vizNames.map((name) => ({ vizName: name, url: '' })),
    generateCoverSlice: false,
    coverSliceMode: 'nth',
    coverSliceNth: 1,
    coverSliceName: 'Median Mosaic',
    cloudCover: 90,
    coverRegistrationUrl: '',
    coverSearchBody: '',
  };
};

export type StacPreset = {
  id: string;
  label: string;
  config: Omit<StacConfig, 'startDate' | 'endDate'>;
};

const PC_REGISTER_URL = 'https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register';
const PC_TILES_BASE =
  'https://planetarycomputer.microsoft.com/api/data/v1/mosaic/{searchId}/tiles/WebMercatorQuad/{z}/{x}/{y}';

const BASE_PRESET_CONFIG: Omit<
  StacConfig,
  'startDate' | 'endDate' | 'vizUrls' | 'searchBody' | 'cloudCover'
> = {
  registrationUrl: PC_REGISTER_URL,
  collectionPeriodInterval: 1,
  collectionPeriodUnit: 'months',
  slicePeriodInterval: 1,
  slicePeriodUnit: 'weeks',
  generateCoverSlice: false,
  coverSliceMode: 'nth',
  coverSliceNth: 1,
  coverSliceName: 'Median Mosaic',
  coverRegistrationUrl: '',
  coverSearchBody: '',
};

function makeSearchBody(
  collections: string[],
  cloudCover: number | null,
  extraFilters: object[] = []
): string {
  const args: object[] = [
    {
      op: 'anyinteracts',
      args: [
        { property: 'datetime' },
        { interval: ['{startDatetimePlaceholder}', '{endDatetimePlaceholder}'] },
      ],
    },
  ];
  if (cloudCover !== null) {
    args.push({ op: '<=', args: [{ property: 'eo:cloud_cover' }, cloudCover] });
  }
  args.push(...extraFilters);

  return JSON.stringify(
    {
      bbox: '{campaignBBoxPlaceholder}',
      filter: { op: 'and', args },
      metadata: { type: 'mosaic', maxzoom: 24, minzoom: 0, pixel_selection: 'median' },
      filterLang: 'cql2-json',
      collections,
    },
    null,
    2
  );
}

export const STAC_PRESETS: StacPreset[] = [
  {
    id: 'sentinel2',
    label: 'Sentinel-2 L2A',
    config: {
      ...BASE_PRESET_CONFIG,
      cloudCover: 90,
      searchBody: makeSearchBody(['sentinel-2-l2a'], 90, [
        { op: '=', args: [{ property: 'collection' }, 'sentinel-2-l2a'] },
      ]),
      vizUrls: [
        {
          vizName: 'True Color',
          url: `${PC_TILES_BASE}?assets=B04&assets=B03&assets=B02&nodata=0&color_formula=Gamma+RGB+3.2+Saturation+0.8+Sigmoidal+RGB+25+0.35&collection=sentinel-2-l2a&pixel_selection=median`,
        },
        {
          vizName: 'False Color',
          url: `${PC_TILES_BASE}?assets=B08&assets=B04&assets=B03&nodata=0&color_formula=Gamma+RGB+3.7+Saturation+1.5+Sigmoidal+RGB+15+0.35&collection=sentinel-2-l2a&pixel_selection=median`,
        },
      ],
    },
  },
  {
    id: 'landsat',
    label: 'Landsat C2 L2',
    config: {
      ...BASE_PRESET_CONFIG,
      cloudCover: 70,
      searchBody: makeSearchBody(['landsat-c2-l2'], 70, [
        { op: '=', args: [{ property: 'collection' }, 'landsat-c2-l2'] },
      ]),
      vizUrls: [
        {
          vizName: 'True Color',
          url: `${PC_TILES_BASE}?collection=landsat-c2-l2&assets=red&assets=green&assets=blue&color_formula=gamma+RGB+2.7,+saturation+1.5,+sigmoidal+RGB+15+0.55&nodata=0&pixel_selection=median&rescale=0,30000`,
        },
      ],
    },
  },
  {
    id: 'hls',
    label: 'Harmonized Landsat Sentinel (HLS)',
    config: {
      ...BASE_PRESET_CONFIG,
      cloudCover: 70,
      searchBody: makeSearchBody(['hls2-l30', 'hls2-s30'], 70),
      vizUrls: [
        {
          vizName: 'True Color',
          url: `${PC_TILES_BASE}?collection=hls2-s30&collection=hls2-l30&assets=B04&assets=B03&assets=B02&color_formula=gamma+RGB+2.7,+saturation+1.5,+sigmoidal+RGB+15+0.55&nodata=0&pixel_selection=median&rescale=0,3000`,
        },
      ],
    },
  },
  {
    id: 'naip',
    label: 'National Agriculture Imagery Program (NAIP)',
    config: {
      ...BASE_PRESET_CONFIG,
      cloudCover: 90,
      searchBody: makeSearchBody(['naip'], null, [
        { op: '=', args: [{ property: 'collection' }, 'naip'] },
      ]),
      vizUrls: [
        {
          vizName: 'True Color',
          url: `${PC_TILES_BASE}?asset_bidx=image%7C1%2C2%2C3&assets=image&collection=naip&format=png`,
        },
      ],
    },
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

export function allCollectionsFlat(
  sources: ImagerySource[]
): { source: ImagerySource; collection: CollectionItem }[] {
  return sources.flatMap((s) => s.collections.map((c) => ({ source: s, collection: c })));
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
