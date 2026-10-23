import type {
  CollectionItem,
  ImageryGenerationConfig,
  ImageryGenerationSeries,
  ImagerySlice,
  ImagerySource,
  StacBrowserCollectionData,
} from './types';
import { isPlanetSceneConfig } from './types';

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
export const DEFAULT_MAX_CLOUD_COVER = 90;

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
      visualizations: currentData.visualizations,
      coverVisualizations: currentData.coverVisualizations ?? [],
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
  const previousByRange = new Map(previous.map((c) => [collectionRangeKey(c), c]));
  return generated.map((collection) => {
    const match = previousByRange.get(collectionRangeKey(collection));
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
