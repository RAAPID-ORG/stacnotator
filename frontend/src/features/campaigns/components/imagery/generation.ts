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
}

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
        collection.generationSeriesId === series.id &&
        collection.data.type === 'stac_browser' &&
        collection.data.mode === 'mosaic'
    );
    if (candidates.length === 0) return [];
    const candidateIds = new Set(candidates.map((collection) => collection.id));
    const savedConfig = series.config;
    const currentData = candidates[0].data as StacBrowserCollectionData;
    const config = {
      ...savedConfig,
      // Rendering configuration may have been edited through per-collection
      // tools since generation; temporal inputs still come from the snapshot.
      catalogUrl: currentData.catalogUrl,
      stacCollectionId: currentData.stacCollectionId,
      isMpc: currentData.isMpc,
      tiler: currentData.tiler,
      maxCloudCover: currentData.maxCloudCover ?? savedConfig.maxCloudCover,
      visualizations: currentData.visualizations,
      coverVisualizations: currentData.coverVisualizations ?? [],
      internalStorage: currentData.internalStorage,
    };
    return [
      {
        id: series.id,
        collections: earliest(candidates),
        otherCollections: source.collections.filter((c) => !candidateIds.has(c.id)),
        config,
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
