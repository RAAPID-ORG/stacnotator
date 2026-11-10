import type {
  BasemapOut,
  ImageryEditorStateCreate,
  ImagerySourceCreate,
  ImagerySourceOut,
} from '~/api/client';
import { formatSliceLabel } from '~/shared/utils/utility';
import { COLLECTION_PRESETS } from './collectionPresets';
import { mapSourceOutToFe } from './controller';
import { basemapToBackend, sourceToBackend } from './draftSync';
import { sourceFromGenerated, stacCollection, type StacSearchSettings } from './generation';
import { collectionDefaults, MPC_API_URL, MPC_PRESETS, presetVisualizations } from './mpcPresets';
import { createId, DEFAULT_BASEMAPS, type ImagerySlice } from './types';

/** Dates are YYYY-MM-DD, both ends included. */
export interface RecipeSlice {
  start: string;
  end: string;
  name?: string;
}

/** One collection: the slices annotators step through, and the cover that stands for
 *  the window, either one of the slices by index or its own dedicated date range. */
export interface RecipeWindow {
  name: string;
  slices: RecipeSlice[];
  cover: number | RecipeSlice;
}

/** One imagery source over a preset collection, its windows spelled out. */
export interface ImageryRecipe {
  collection: string;
  windows: RecipeWindow[];
  visualizations?: string[];
  max_cloud_cover?: number;
  name?: string;
}

export interface StacCollectionInfo {
  id: string;
  title: string;
  has_cloud_cover?: boolean | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function setupOptions() {
  return {
    collections: MPC_PRESETS.map((preset) => ({
      id: preset.stacCollectionId,
      label: preset.label,
      visualizations: (COLLECTION_PRESETS[preset.stacCollectionId] ?? []).map((p) => p.label),
    })),
    basemaps: DEFAULT_BASEMAPS.map((b) => b.name),
  };
}

function slice(given: RecipeSlice, where: string): ImagerySlice {
  const valid = (d: string) => DAY.test(d) && !Number.isNaN(Date.parse(d));
  if (!valid(given.start) || !valid(given.end) || given.start > given.end) {
    throw new Error(
      `${where}: start and end must be YYYY-MM-DD with start <= end, got ${given.start}..${given.end}`
    );
  }
  return {
    id: createId(),
    name: given.name ?? formatSliceLabel(given.start, given.end, null, 0),
    startDate: given.start,
    endDate: given.end,
  };
}

export function sourceFromRecipe(
  recipe: ImageryRecipe,
  collection: StacCollectionInfo
): ImagerySourceCreate {
  const preset = MPC_PRESETS.find((p) => p.stacCollectionId === recipe.collection);
  if (!preset) {
    throw new Error(
      `Unknown collection "${recipe.collection}"; use one of ${MPC_PRESETS.map((p) => p.stacCollectionId).join(', ')}`
    );
  }
  if (!recipe.windows?.length) throw new Error(`${recipe.collection}: give at least one window`);
  const defaults = collectionDefaults(collection, preset, recipe.visualizations);
  const cloudCover = recipe.max_cloud_cover ?? 90;
  const search: StacSearchSettings = {
    catalogUrl: MPC_API_URL,
    stacCollectionId: collection.id,
    isMpc: true,
    hasCloudCover: !!collection.has_cloud_cover,
    tiler: null,
    maxCloudCover: cloudCover,
    itemSort: defaults.itemSort,
    coverMaxCloudCover: cloudCover,
    coverItemSort: defaults.coverItemSort,
    visualizations: defaults.visualizations,
    coverVisualizations: presetVisualizations(collection.id, 'first', recipe.visualizations),
  };
  const collections = recipe.windows.map((window) => {
    const where = `window "${window.name}"`;
    if (!window.slices?.length) throw new Error(`${where}: give at least one slice`);
    const slices = window.slices.map((s, i) => slice(s, `${where} slice ${i}`));
    if (
      typeof window.cover === 'number' &&
      (!Number.isInteger(window.cover) || window.cover < 0 || window.cover >= slices.length)
    ) {
      throw new Error(`${where}: cover ${window.cover} is not a slice index`);
    }
    const cover =
      typeof window.cover === 'number' ? window.cover : slice(window.cover, `${where} cover`);
    return stacCollection(search, { name: window.name, slices, cover });
  });
  return sourceToBackend(sourceFromGenerated(collections, undefined, recipe.name ?? preset.label));
}

function sourcesFromRecipes(
  recipes: ImageryRecipe[],
  collections: StacCollectionInfo[]
): ImagerySourceCreate[] {
  const sources = recipes.map((recipe) => {
    const info = collections.find((c) => c.id === recipe.collection) ?? {
      id: recipe.collection,
      title: recipe.collection,
    };
    return sourceFromRecipe(recipe, info);
  });
  const names = sources.map((s) => s.name);
  const repeated = names.filter((n, i) => names.indexOf(n) !== i);
  if (repeated.length > 0) {
    throw new Error(`Two recipes make a source named ${repeated.join(', ')}; give them names`);
  }
  return sources;
}

function defaultBasemaps(names: string[] | undefined, current: BasemapOut[] = []) {
  const unknown = (names ?? []).filter((n) => !DEFAULT_BASEMAPS.some((b) => b.name === n));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown basemaps ${unknown.join(', ')}; use ${DEFAULT_BASEMAPS.map((b) => b.name).join(', ')}`
    );
  }
  return DEFAULT_BASEMAPS.filter((b) => !names || names.includes(b.name)).map((b) => {
    const stored = current.find((c) => c.name === b.name);
    return basemapToBackend(stored ? { ...b, id: String(stored.id) } : b);
  });
}

export function imageryEditorState(
  recipes: ImageryRecipe[],
  collections: StacCollectionInfo[],
  basemaps?: string[]
): ImageryEditorStateCreate {
  return {
    sources: sourcesFromRecipes(recipes, collections),
    basemaps: defaultBasemaps(basemaps),
  };
}

/** A campaign's imagery with the recipes' sources added, or put in place of the stored
 *  source of the same name, which keeps its id so the views showing it still do. Sources
 *  named in `remove` are dropped and every other one is kept as stored. Basemaps are
 *  replaced by the named defaults when given, and kept otherwise. */
export function mergedImagery(
  current: { sources: ImagerySourceOut[]; basemaps: BasemapOut[] },
  recipes: ImageryRecipe[],
  collections: StacCollectionInfo[],
  options: { basemaps?: string[]; remove?: string[] } = {}
): ImageryEditorStateCreate {
  const remove = options.remove ?? [];
  const unknown = remove.filter((n) => !current.sources.some((s) => s.name === n));
  if (unknown.length > 0) {
    throw new Error(
      `No source named ${unknown.join(', ')}; the campaign has ${current.sources.map((s) => s.name).join(', ')}`
    );
  }
  const built = sourcesFromRecipes(recipes, collections);
  const sources = current.sources
    .filter((stored) => !remove.includes(stored.name))
    .map((stored) => {
      const replacement = built.find((b) => b.name === stored.name);
      return replacement
        ? { ...replacement, id: stored.id }
        : sourceToBackend(mapSourceOutToFe(stored));
    });
  const added = built.filter((b) => !current.sources.some((s) => s.name === b.name));
  return {
    sources: [...sources, ...added],
    basemaps: options.basemaps
      ? defaultBasemaps(options.basemaps, current.basemaps)
      : current.basemaps.map((b) =>
          basemapToBackend({
            id: String(b.id),
            name: b.name,
            url: b.url,
            maxNativeZoom: b.max_native_zoom ?? undefined,
            organizationApiKeyId: b.organization_api_key_id,
          })
        ),
  };
}
