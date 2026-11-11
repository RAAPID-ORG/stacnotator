import { COLLECTION_PRESETS, presetVizParams, type BandPreset } from './collectionPresets';
import type { ItemSortOption, NamedVizParams } from './types';
import { emptyVizParams } from './types';

export type TemporalPattern =
  | 'monthly-weekly'
  | 'monthly-monthly'
  | 'weekly-weekly'
  | 'yearly-monthly'
  | 'yearly-yearly'
  | 'custom';

export interface CatalogBrowserPreset {
  /** STAC collection ID within MPC (e.g. 'sentinel-2-l2a') */
  stacCollectionId: string;
  /** Human label */
  label: string;
  /** Temporal pattern to preselect; falls back to the form defaults (monthly/weekly) */
  temporalPattern?: Exclude<TemporalPattern, 'custom'>;
  /** Cover to preselect; falls back to a generated cover for cloud-bearing collections */
  coverMode?: 'nth' | 'custom';
}

/** Presets that map directly to MPC STAC collections */
export const MPC_PRESETS: CatalogBrowserPreset[] = [
  { stacCollectionId: 'sentinel-2-l2a', label: 'Sentinel-2 L2A' },
  { stacCollectionId: 'landsat-c2-l2', label: 'Landsat C2 L2' },
  { stacCollectionId: 'hls2-s30', label: 'HLS Sentinel-2 (S30)' },
  { stacCollectionId: 'hls2-l30', label: 'HLS Landsat (L30)' },
  // NAIP flies each state roughly every 2-3 years and carries no cloud metadata, so
  // sub-yearly windows produce empty slices and a composited cover buys nothing.
  { stacCollectionId: 'naip', label: 'NAIP', temporalPattern: 'yearly-yearly', coverMode: 'nth' },
  { stacCollectionId: 'sentinel-1-grd', label: 'Sentinel-1 GRD' },
  { stacCollectionId: 'cop-dem-glo-30', label: 'Copernicus DEM 30m' },
];

export const MPC_API_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1';

/** Visualizations from a collection's band presets: the named ones, or True Color +
 *  False Color when it has them. Falls back to a single empty "True Color" viz if no
 *  presets exist. */
export function presetVisualizations(
  collectionId: string,
  compositingOverride?: string,
  names?: string[]
): NamedVizParams[] {
  const base = {
    ...emptyVizParams(),
    ...(compositingOverride ? { compositing: compositingOverride } : {}),
  };
  const presets = COLLECTION_PRESETS[collectionId] ?? [];
  const build = (preset: BandPreset): NamedVizParams => ({
    name: preset.label,
    vizParams: presetVizParams(preset, collectionId, base),
  });
  if (names) {
    return names.map((name) => {
      const preset = presets.find((p) => p.label === name);
      if (!preset) {
        throw new Error(
          `${collectionId} has no visualization "${name}"; it has ${presets.map((p) => `"${p.label}"`).join(', ')}`
        );
      }
      return build(preset);
    });
  }
  if (presets.length === 0) return [{ name: 'True Color', vizParams: base }];

  const trueColor = presets.find((p) => p.label.toLowerCase().includes('true color'));
  const falseColor = presets.find((p) => p.label.toLowerCase().includes('false color'));
  const vizs = [trueColor, falseColor].filter((p): p is BandPreset => !!p).map(build);
  return vizs.length > 0 ? vizs : [build(presets[0])];
}

export interface CollectionDefaults {
  visualizations: NamedVizParams[];
  coverMode: 'nth' | 'custom';
  coverVisualizations: NamedVizParams[];
  itemSort: ItemSortOption;
  coverItemSort: ItemSortOption;
  temporalPattern?: Exclude<TemporalPattern, 'custom'>;
}

/** What the wizard preselects for a collection: cloud-bearing imagery sorts by cloud
 *  cover and gets a composited cover slice; everything else takes the latest item. */
export function collectionDefaults(
  collection: { id: string; has_cloud_cover?: boolean | null },
  preset?: CatalogBrowserPreset | null,
  visualizationNames?: string[]
): CollectionDefaults {
  const cloudy = !!collection.has_cloud_cover;
  const sort: ItemSortOption = cloudy ? 'cloud_cover_asc' : 'date_desc';
  const coverMode = preset?.coverMode ?? (cloudy ? 'custom' : 'nth');
  return {
    visualizations: presetVisualizations(collection.id, undefined, visualizationNames),
    coverMode,
    coverVisualizations:
      coverMode === 'custom'
        ? presetVisualizations(collection.id, 'first', visualizationNames)
        : [],
    itemSort: sort,
    coverItemSort: sort,
    temporalPattern: preset?.temporalPattern,
  };
}
