import type {
  BasemapOut,
  ImageryEditorStateCreate,
  ImagerySourceOut,
  PlanetSeriesMosaicsOut,
} from '~/api/client';
import { formatSliceLabel } from '~/shared/utils/utility';
import { COLLECTION_PRESETS } from './collectionPresets';
import { mapSourceOutToFe } from './controller';
import { basemapToBackend, sourceToBackend } from './draftSync';
import {
  retainMatchingIds,
  sourceFromGenerated,
  stacCollection,
  type StacSearchSettings,
} from './generation';
import { collectionDefaults, MPC_API_URL, MPC_PRESETS, presetVisualizations } from './mpcPresets';
import { manualCollection, toSlice, usableMosaics } from './planetGeneration';
import {
  createId,
  DEFAULT_BASEMAPS,
  emptySource,
  type ImagerySlice,
  type ImagerySource,
} from './types';

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

/** A Planet basemap series, read with one of the organization's keys by id: the key
 *  itself stays on the server. */
export interface PlanetRecipe {
  key_id: number;
  series: string;
}

/** One imagery source over a preset collection or a Planet series, its windows spelled
 *  out. */
export interface ImageryRecipe {
  collection?: string;
  planet?: PlanetRecipe;
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

function recipeSource(recipe: ImageryRecipe, collection: StacCollectionInfo): ImagerySource {
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
  return sourceFromGenerated(collections, undefined, recipe.name ?? preset.label);
}

function coverIndex(cover: RecipeWindow['cover'], slices: number, where: string): number {
  if (typeof cover !== 'number' || !Number.isInteger(cover) || cover < 0 || cover >= slices) {
    throw new Error(
      `${where}: cover must be the index of one of its slices, got ${JSON.stringify(cover)}`
    );
  }
  return cover;
}

/** Planet mosaics are finished tiles: each recipe slice is the one mosaic starting inside
 *  it, and a cover can only be one of the slices. */
function planetRecipeSource(recipe: ImageryRecipe, series: PlanetSeriesMosaicsOut): ImagerySource {
  const label = recipe.name ?? recipe.planet!.series;
  if (!recipe.windows?.length) throw new Error(`${label}: give at least one window`);
  const visualizations = recipe.visualizations ?? series.renderings;
  const unknown = visualizations.filter((v) => !series.renderings.includes(v));
  if (unknown.length > 0) {
    throw new Error(
      `${label}: unknown visualizations ${unknown.join(', ')}; use ${series.renderings.join(', ')}`
    );
  }
  const mosaics = usableMosaics(series.mosaics);
  const starts = mosaics.map((m) => m.first_acquired).sort();
  const available = starts.length
    ? `its ${starts.length} mosaics start from ${starts[0]} to ${starts[starts.length - 1]}`
    : 'it has no usable mosaics';
  const collections = recipe.windows.map((window) => {
    const where = `window "${window.name}"`;
    if (!window.slices?.length) throw new Error(`${where}: give at least one slice`);
    const slices = window.slices.map((given, i) => {
      const at = `${where} slice ${i}`;
      slice(given, at);
      const inside = mosaics.filter(
        (m) => m.first_acquired >= given.start && m.first_acquired <= given.end
      );
      if (inside.length !== 1) {
        throw new Error(
          `${at}: ${inside.length} mosaics of ${recipe.planet!.series} start in ${given.start}..${given.end}, give one slice per mosaic; ${available}`
        );
      }
      return toSlice(inside[0], visualizations, given.name);
    });
    const cover = coverIndex(window.cover, slices.length, where);
    return manualCollection(
      window.name,
      slices,
      { index: cover, dedicated: false },
      slices[0].vizUrls ?? []
    );
  });
  return {
    ...emptySource(),
    name: label,
    visualizations: visualizations.map((name) => ({ name })),
    collections,
    maxNativeZoom: series.max_native_zoom ?? null,
    organizationApiKeyId: recipe.planet!.key_id,
  };
}

function defaultBasemaps(names: string[], current: BasemapOut[]) {
  const unknown = names.filter((n) => !DEFAULT_BASEMAPS.some((b) => b.name === n));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown basemaps ${unknown.join(', ')}; use ${DEFAULT_BASEMAPS.map((b) => b.name).join(', ')}`
    );
  }
  return DEFAULT_BASEMAPS.filter((b) => names.includes(b.name)).map((b) => {
    const stored = current.find((c) => c.name === b.name);
    return basemapToBackend(stored ? { ...b, id: String(stored.id) } : b);
  });
}

/** A campaign's imagery (none for a new one) with the recipes' sources added, or put in
 *  place of the stored source of the same name. A replaced source keeps its id and
 *  display settings, and its windows and slices whose dates are unchanged keep theirs, so
 *  views, layouts and registrations hold. Sources named in `remove` are dropped and every
 *  other one is kept as stored. Basemaps are replaced by the named defaults when given,
 *  and kept otherwise. */
export function mergedImagery(
  current: { sources: ImagerySourceOut[]; basemaps: BasemapOut[] },
  recipes: ImageryRecipe[],
  collections: StacCollectionInfo[],
  options: {
    basemaps?: string[];
    remove?: string[];
    planetSeries?: Map<ImageryRecipe, PlanetSeriesMosaicsOut>;
  } = {}
): ImageryEditorStateCreate {
  const remove = options.remove ?? [];
  const unknown = remove.filter((n) => !current.sources.some((s) => s.name === n));
  if (unknown.length > 0) {
    throw new Error(
      `No source named ${unknown.join(', ')}; the campaign has ${current.sources.map((s) => s.name).join(', ')}`
    );
  }
  const built = recipes.map((recipe) => {
    if (!recipe.collection === !recipe.planet) {
      throw new Error('Give each recipe exactly one of collection or planet');
    }
    if (recipe.planet) {
      const series = options.planetSeries?.get(recipe);
      if (!series) throw new Error(`Planet series ${recipe.planet.series} was not loaded`);
      return planetRecipeSource(recipe, series);
    }
    const id = recipe.collection!;
    return recipeSource(recipe, collections.find((c) => c.id === id) ?? { id, title: id });
  });
  const names = built.map((s) => s.name);
  const repeated = names.filter((n, i) => names.indexOf(n) !== i);
  if (repeated.length > 0) {
    throw new Error(`Two recipes make a source named ${repeated.join(', ')}; give them names`);
  }
  const sources = current.sources
    .filter((stored) => !remove.includes(stored.name))
    .map((stored) => {
      const previous = mapSourceOutToFe(stored);
      const replacement = built.find((b) => b.name === stored.name);
      return sourceToBackend(
        replacement
          ? {
              ...previous,
              visualizations: replacement.visualizations,
              generationSeries: replacement.generationSeries,
              ...(replacement.organizationApiKeyId != null && {
                organizationApiKeyId: replacement.organizationApiKeyId,
                maxNativeZoom: replacement.maxNativeZoom,
              }),
              collections: retainMatchingIds(replacement.collections, previous.collections),
            }
          : previous
      );
    });
  const added = built
    .filter((b) => !current.sources.some((s) => s.name === b.name))
    .map(sourceToBackend);
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
