import type {
  BasemapOut,
  CampaignOutFull,
  CustomMapOut,
  ImageryCollectionOut,
  ImagerySliceOut,
  ImagerySourceOut,
  ImageryViewOut,
  VectorLayerOut,
  VisualizationTemplateOut,
} from '~/api/client';

export type Bbox = [number, number, number, number];

/** Indexed view over a campaign's imagery, built once per load so navigation
 *  and layer building never rescan the nested response. */
export interface ImageryCatalog {
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

export function buildImageryCatalog(campaign: CampaignOutFull): ImageryCatalog {
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
  cat: ImageryCatalog,
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

/** Custom maps the map can actually draw. Registration is asynchronous, so a
 *  campaign can hold overlays that have no tiles yet. */
export function readyCustomMaps(maps: CustomMapOut[]): CustomMapOut[] {
  return maps.filter((m) => m.status === 'ready' && !!m.tile_url);
}
