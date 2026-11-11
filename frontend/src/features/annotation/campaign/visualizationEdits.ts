import type {
  CampaignOutFull,
  CollectionVisualizationOut,
  ImageryCollectionOut,
  ImagerySourceOut,
  RenderParams,
  SliceTileOut,
  VisualizationPatch,
} from '~/api/client';
import { restampTileUrl } from '~/shared/imagery/renderQuery';
import type { ImageryCatalog } from './imagery';

/** How a viewer redraws one visualization, kept in their browser. An edit with a
 *  `copy` is a visualization they made themselves from one of the source's: its
 *  id is negative so it never meets a saved one. */
export interface VisualizationEdit {
  patch: VisualizationPatch;
  copy?: { sourceId: number; baseId: number; name: string };
}

/** The viewer's edits, by visualization id. */
export type VisualizationEdits = Record<number, VisualizationEdit>;

interface Copy {
  id: number;
  baseId: number;
  name: string;
  patch: VisualizationPatch;
}

export const isStacCollection = (collection: ImageryCollectionOut): boolean =>
  collection.search != null;

/** Every field the patch names replaces the one in `params`; a null removes it.
 *  None when nothing would be left to draw. */
export function patchedParams(
  params: Record<string, unknown>,
  patch: VisualizationPatch
): RenderParams | null {
  const next: Record<string, unknown> = { ...params };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  const result = next as RenderParams;
  return result.assets?.length || result.expression ? result : null;
}

/** The parameters a slice is drawn with: the cover's own where it has them. */
export function sliceParams(
  collection: ImageryCollectionOut,
  row: CollectionVisualizationOut,
  sliceIndex: number
): Record<string, unknown> {
  const cover = collection.has_dedicated_cover && sliceIndex === collection.cover_slice_index;
  return cover && row.cover_params ? row.cover_params : row.params;
}

function editedRow(
  row: CollectionVisualizationOut,
  patch: VisualizationPatch,
  visualizationId: number
): CollectionVisualizationOut | null {
  const params = patchedParams(row.params, patch);
  if (!params) return null;
  const cover = row.cover_params ? patchedParams(row.cover_params, patch) : null;
  return {
    visualization_id: visualizationId,
    params: params as Record<string, unknown>,
    cover_params: (cover ?? row.cover_params ?? null) as Record<string, unknown> | null,
  };
}

function restamped(
  collection: ImageryCollectionOut,
  tile: SliceTileOut,
  row: CollectionVisualizationOut,
  sliceIndex: number
): SliceTileOut {
  return {
    ...tile,
    visualization_id: row.visualization_id,
    url: restampTileUrl(tile.url, tile.tiler, sliceParams(collection, row, sliceIndex)),
  };
}

function editCollection(
  collection: ImageryCollectionOut,
  edits: VisualizationEdits,
  copies: Copy[]
): ImageryCollectionOut {
  const rows = collection.visualizations ?? [];
  const edited = new Map<number, CollectionVisualizationOut>();
  for (const row of rows) {
    const patch = edits[row.visualization_id]?.patch;
    const next = patch && editedRow(row, patch, row.visualization_id);
    if (next) edited.set(row.visualization_id, next);
  }
  const extra: Array<{ baseId: number; row: CollectionVisualizationOut }> = [];
  for (const viz of copies) {
    const base = rows.find((row) => row.visualization_id === viz.baseId);
    const row = base && editedRow(base, viz.patch, viz.id);
    if (row) extra.push({ baseId: viz.baseId, row });
  }
  if (!edited.size && !extra.length) return collection;

  return {
    ...collection,
    visualizations: [
      ...rows.map((row) => edited.get(row.visualization_id) ?? row),
      ...extra.map(({ row }) => row),
    ],
    slices: collection.slices.map((slice, index) => {
      const tiles = slice.tiles.map((tile) => {
        const row = edited.get(tile.visualization_id);
        return row ? restamped(collection, tile, row, index) : tile;
      });
      for (const { baseId, row } of extra) {
        const base = slice.tiles.find((tile) => tile.visualization_id === baseId);
        if (base) tiles.push(restamped(collection, base, row, index));
      }
      return { ...slice, tiles };
    }),
  };
}

export function editSource(source: ImagerySourceOut, edits: VisualizationEdits): ImagerySourceOut {
  const copies: Copy[] = Object.entries(edits).flatMap(([id, { patch, copy }]) =>
    copy?.sourceId === source.id && source.visualizations.some((v) => v.id === copy.baseId)
      ? [{ id: Number(id), baseId: copy.baseId, name: copy.name, patch }]
      : []
  );
  if (!copies.length && !source.visualizations.some((viz) => edits[viz.id])) return source;
  const lastOrder = Math.max(-1, ...source.visualizations.map((viz) => viz.display_order));
  return {
    ...source,
    visualizations: [
      ...source.visualizations,
      ...copies.map((viz, i) => ({ id: viz.id, name: viz.name, display_order: lastOrder + 1 + i })),
    ],
    collections: source.collections.map((collection) =>
      isStacCollection(collection) ? editCollection(collection, edits, copies) : collection
    ),
  };
}

/**
 * The catalog with the viewer's own visualization edits drawn in. Every source with a
 * STAC collection is rebuilt from the campaign as loaded, so an edit taken back
 * restores what the server sent; scene sources, which a viewport search rewrites, are
 * left as they are.
 */
export function withVisualizationEdits(
  cat: ImageryCatalog,
  campaign: CampaignOutFull,
  edits: VisualizationEdits
): ImageryCatalog {
  const sources = new Map(cat.sources);
  const collections = new Map(cat.collections);
  const slices = new Map(cat.slices);
  const vizzes = new Map(cat.vizzes);

  for (const original of campaign.imagery_sources) {
    if (!original.collections.some(isStacCollection)) continue;
    for (const viz of cat.sources.get(original.id)?.visualizations ?? []) vizzes.delete(viz.id);
    const source = editSource(original, edits);
    sources.set(source.id, source);
    for (const viz of source.visualizations) vizzes.set(viz.id, viz);
    for (const collection of source.collections) {
      collections.set(collection.id, collection);
      for (const slice of collection.slices) slices.set(slice.id, slice);
    }
  }
  return { ...cat, sources, collections, slices, vizzes };
}

/** A visualization of the viewer's own on `source`, starting out drawn like `vizId`
 *  is, under `name` or the first numbered variant of it no visualization there has. */
export function ownCopy(
  source: ImagerySourceOut,
  edits: VisualizationEdits,
  vizId: number,
  name: string
): VisualizationEdit {
  const taken = new Set(source.visualizations.map((viz) => viz.name));
  let unique = name;
  for (let n = 2; taken.has(unique); n++) unique = `${name} ${n}`;
  const from = edits[vizId];
  return {
    patch: from?.patch ?? {},
    copy: { sourceId: source.id, baseId: from?.copy?.baseId ?? vizId, name: unique },
  };
}
