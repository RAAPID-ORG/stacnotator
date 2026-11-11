import { formatSliceLabel, formatWindowLabel } from '~/shared/utils/utility';
import type {
  CollectionItem,
  GenerationRecipe,
  ImageryGenerationConfig,
  ImageryGenerationSeries,
  ImagerySlice,
  ImagerySource,
  NamedVizParams,
  StacBrowserCollectionData,
} from './types';
import { createId, emptySource, emptyVizParams, isPlanetSceneConfig } from './types';

export interface EditableGenerationSeries {
  id: string;
  collections: CollectionItem[];
  otherCollections: CollectionItem[];
  config: ImageryGenerationConfig;
  /** Set when the series reads a private catalog. Its SAS is write-only once saved, so the
   *  editor asks for it again; only an unsaved series still holds the typed `sasToken`. */
  privateCatalog?: PrivateCatalog;
}

export interface PrivateCatalog {
  sasToken?: string;
}

/** What the generator offers until someone picks otherwise. */
const DEFAULT_MAX_CLOUD_COVER = 90;

const regularSlices = (collection: CollectionItem): ImagerySlice[] =>
  collection.hasDedicatedCover
    ? collection.slices.filter((_, i) => i !== collection.coverSliceIndex)
    : collection.slices;

const earliest = (collections: CollectionItem[]) =>
  [...collections].sort((a, b) => {
    const aStart = regularSlices(a)[0]?.startDate ?? '';
    const bStart = regularSlices(b)[0]?.startDate ?? '';
    return aStart.localeCompare(bStart);
  });

/** The source's visualizations in its order, each with the parameters the
 *  collection has for it. One added under the source after the collection was
 *  generated has none yet and starts empty, so it is a tab in the generator,
 *  which is where it gets them. */
function sourceVisualizations(
  source: ImagerySource,
  own: NamedVizParams[],
  cover = false
): NamedVizParams[] {
  const named = source.visualizations.filter((viz) => viz.name.trim());
  if (named.length === 0) return own;
  const byName = new Map(own.map((viz) => [viz.name, viz]));
  return named.map(
    ({ name }) =>
      byName.get(name) ?? {
        name,
        vizParams: cover ? { ...emptyVizParams(), compositing: 'first' } : emptyVizParams(),
      }
  );
}

/** Resolve every explicitly persisted series. Configuration ownership is on
 * the source-level series; collections only provide membership. */
export function editableGenerationSeries(source: ImagerySource): EditableGenerationSeries[] {
  return source.generationSeries.flatMap((series: ImageryGenerationSeries) => {
    if (isPlanetSceneConfig(series.config)) return [];
    const candidates = source.collections.filter(
      (collection) =>
        collection.generationSeriesId === series.id && collection.data.type === 'stac_browser'
    );
    if (candidates.length === 0) return [];
    const candidateIds = new Set(candidates.map((collection) => collection.id));
    const ordered = earliest(candidates);
    const currentData = ordered[0].data as StacBrowserCollectionData;
    // The series stores the period and how it was cut; the search and
    // renderings are its collections', which is where they are edited.
    const config: ImageryGenerationConfig = {
      ...series.config,
      catalogUrl: currentData.catalogUrl,
      stacCollectionId: currentData.stacCollectionId,
      isMpc: currentData.isMpc,
      tiler: currentData.tiler,
      maxCloudCover: currentData.maxCloudCover ?? DEFAULT_MAX_CLOUD_COVER,
      itemSort: currentData.itemSort ?? 'date_desc',
      coverMaxCloudCover: currentData.coverMaxCloudCover ?? DEFAULT_MAX_CLOUD_COVER,
      coverItemSort: currentData.coverItemSort ?? 'cloud_cover_asc',
      visualizations: sourceVisualizations(source, currentData.visualizations),
      // An empty list means the cover is the nth slice, not a custom one.
      coverVisualizations: currentData.coverVisualizations?.length
        ? sourceVisualizations(source, currentData.coverVisualizations, true)
        : [],
      searchQuery: currentData.searchQuery,
      coverSearchQuery: currentData.coverSearchQuery,
      internalStorage: currentData.internalStorage,
    };
    return [
      {
        id: series.id,
        collections: ordered,
        otherCollections: source.collections.filter((c) => !candidateIds.has(c.id)),
        config,
        privateCatalog:
          currentData.storageAccess || currentData.sasToken
            ? { sasToken: currentData.sasToken }
            : undefined,
      },
    ];
  });
}

const collectionRangeKey = (collection: CollectionItem) => {
  const slices = regularSlices(collection);
  return `${slices[0]?.startDate ?? ''}/${slices.at(-1)?.endDate ?? ''}`;
};

/** Preserve database identities for unchanged windows/slices so editing one
 * generator field doesn't unnecessarily churn layouts and registrations. */
export function retainMatchingIds(
  generated: CollectionItem[],
  previous: CollectionItem[]
): CollectionItem[] {
  const previousByRange = new Map<string, CollectionItem[]>();
  for (const c of previous) {
    const key = collectionRangeKey(c);
    previousByRange.set(key, [...(previousByRange.get(key) ?? []), c]);
  }
  return generated.map((collection) => {
    const match = previousByRange.get(collectionRangeKey(collection))?.shift();
    if (!match) return collection;
    const slicesByRange = new Map<string, ImagerySlice[]>();
    for (const slice of match.slices) {
      const key = `${slice.startDate}/${slice.endDate}`;
      slicesByRange.set(key, [...(slicesByRange.get(key) ?? []), slice]);
    }
    return {
      ...collection,
      id: match.id,
      slices: collection.slices.map((slice) => {
        const key = `${slice.startDate}/${slice.endDate}`;
        const queue = slicesByRange.get(key);
        const old = queue?.shift();
        return old ? { ...slice, id: old.id } : slice;
      }),
    };
  });
}

export type PeriodUnit = 'days' | 'weeks' | 'months' | 'years';

const toDateStr = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

function addPeriod(from: Date, interval: number, unit: PeriodUnit): Date {
  const next = new Date(from);
  if (unit === 'days') next.setUTCDate(next.getUTCDate() + interval);
  else if (unit === 'weeks') next.setUTCDate(next.getUTCDate() + interval * 7);
  else if (unit === 'years') next.setUTCFullYear(next.getUTCFullYear() + interval);
  else next.setUTCMonth(next.getUTCMonth() + interval);
  return next;
}

const MIN_TAIL_MS = 3 * 86_400_000;

/** [start, end) periods of ``interval`` ``unit`` covering [from, to), the last cut short.
 *  A cut-short remainder under three days joins the period before it rather than
 *  standing as a slice of a day or two. */
export function periods(
  from: Date,
  to: Date,
  interval: number,
  unit: PeriodUnit
): Array<[Date, Date]> {
  const out: Array<[Date, Date]> = [];
  for (let start = from; start < to; ) {
    const next = addPeriod(start, interval, unit);
    const end = next > to ? to : next;
    const isShortTail = end < next && end.getTime() - start.getTime() < MIN_TAIL_MS;
    if (isShortTail && out.length > 0) out[out.length - 1][1] = end;
    else out.push([start, end]);
    start = end;
  }
  return out;
}

type PeriodSettings = Pick<
  ImageryGenerationConfig,
  'collectionPeriodInterval' | 'collectionPeriodUnit' | 'slicePeriodInterval' | 'slicePeriodUnit'
>;

/** Whether a window holds a single slice, which then is its cover: a dedicated cover
 *  would only repeat it. */
export function oneSlicePerWindow(config: PeriodSettings): boolean {
  const from = new Date(Date.UTC(2001, 0, 1));
  return (
    addPeriod(from, config.slicePeriodInterval, config.slicePeriodUnit) >=
    addPeriod(from, config.collectionPeriodInterval, config.collectionPeriodUnit)
  );
}

const coverModeOf = (config: ImageryGenerationConfig) =>
  oneSlicePerWindow(config) ? 'nth' : config.coverMode;

const lastDay = (end: Date) => toDateStr(new Date(end.getTime() - 86_400_000));

/** How a STAC collection is searched and drawn, apart from its dates. */
export type StacSearchSettings = Omit<
  ImageryGenerationConfig,
  Exclude<keyof GenerationRecipe, 'hasCloudCover'>
>;

/** One window of a STAC collection. ``cover`` is the index of the slice that
 *  stands for the window, or a dedicated slice searched with the cover settings. */
export function stacCollection(
  search: StacSearchSettings,
  window: { name: string; slices: ImagerySlice[]; cover: number | ImagerySlice },
  seriesId?: string,
  sasToken?: string | null
): CollectionItem {
  const dedicated = typeof window.cover !== 'number';
  const cloudy = search.hasCloudCover;
  return {
    id: createId(),
    name: window.name,
    generationSeriesId: seriesId,
    slices: typeof window.cover === 'number' ? window.slices : [window.cover, ...window.slices],
    coverSliceIndex:
      typeof window.cover === 'number'
        ? Math.max(0, Math.min(window.cover, window.slices.length - 1))
        : 0,
    hasDedicatedCover: dedicated,
    data: {
      type: 'stac_browser' as const,
      catalogUrl: search.catalogUrl,
      stacCollectionId: search.stacCollectionId,
      isMpc: search.isMpc,
      tiler: search.tiler,
      // Only meaningful when the items carry eo:cloud_cover. Persisting it
      // otherwise makes the tiler ingest filter on a property the items lack,
      // dropping every item; the search query is gated the same way.
      maxCloudCover: cloudy ? search.maxCloudCover : undefined,
      itemSort: search.itemSort,
      visualizations: search.visualizations,
      coverVisualizations: dedicated ? search.coverVisualizations : undefined,
      coverMaxCloudCover: dedicated && cloudy ? search.coverMaxCloudCover : undefined,
      coverItemSort: dedicated ? search.coverItemSort : undefined,
      searchQuery: search.searchQuery,
      coverSearchQuery: dedicated ? search.coverSearchQuery : undefined,
      internalStorage: search.internalStorage,
      sasToken: sasToken ?? undefined,
      vizUrls: search.visualizations.map((v) => ({ vizName: v.name, url: '' })),
    },
  };
}

/** The period a generator covers, cut into windows of slices, each window
 *  searched and rendered the same way. Dates are whole months: ``startDate`` and
 *  ``endDate`` are YYYY-MM, the range ending with the end date's month. */
export function generateStacCollections(
  config: ImageryGenerationConfig,
  seriesId: string,
  sasToken?: string | null
): CollectionItem[] {
  const [startY, startM] = config.startDate.split('-').map(Number);
  const [endY, endM] = config.endDate.split('-').map(Number);
  const start = new Date(Date.UTC(startY, startM - 1, 1));
  const end = new Date(Date.UTC(endY, endM, 1));
  const custom = coverModeOf(config) === 'custom';

  return periods(start, end, config.collectionPeriodInterval, config.collectionPeriodUnit).map(
    ([windowStart, windowEnd]) => {
      const slices: ImagerySlice[] = periods(
        windowStart,
        windowEnd,
        config.slicePeriodInterval,
        config.slicePeriodUnit
      ).map(([sliceStart, sliceEnd], index) => ({
        id: createId(),
        name: formatSliceLabel(
          toDateStr(sliceStart),
          lastDay(sliceEnd),
          config.slicePeriodUnit,
          index
        ),
        startDate: toDateStr(sliceStart),
        endDate: lastDay(sliceEnd),
      }));
      const windowFirst = toDateStr(windowStart);
      const windowLast = lastDay(windowEnd);
      const cover = custom
        ? {
            id: createId(),
            name: formatSliceLabel(windowFirst, windowLast, config.slicePeriodUnit, 0),
            startDate: windowFirst,
            endDate: windowLast,
          }
        : config.coverSliceNth - 1;
      return stacCollection(
        config,
        {
          name: formatWindowLabel(windowFirst, windowLast, config.collectionPeriodUnit),
          slices,
          cover,
        },
        seriesId,
        sasToken
      );
    }
  );
}

/** The part of a generator's input its series stores. */
export function recipeOf(config: ImageryGenerationConfig): GenerationRecipe {
  return {
    collectionTitle: config.collectionTitle,
    hasCloudCover: config.hasCloudCover,
    startDate: config.startDate,
    endDate: config.endDate,
    collectionPeriodInterval: config.collectionPeriodInterval,
    collectionPeriodUnit: config.collectionPeriodUnit,
    slicePeriodInterval: config.slicePeriodInterval,
    slicePeriodUnit: config.slicePeriodUnit,
    coverMode: coverModeOf(config),
    coverSliceNth: config.coverSliceNth,
  };
}

/** A new source holding what a generator or a single-item pick produced, with the
 *  visualizations of its first collection. */
export function sourceFromGenerated(
  collections: CollectionItem[],
  generationSeries: ImageryGenerationSeries | undefined,
  name: string
): ImagerySource {
  const first = collections[0];
  const vizs = first?.data.type === 'stac_browser' ? first.data.visualizations : [];
  const source = emptySource();
  source.name = name;
  if (vizs.length > 0) source.visualizations = vizs.map((v) => ({ name: v.name }));
  source.generationSeries = generationSeries ? [generationSeries] : [];
  source.collections = collections;
  return source;
}
