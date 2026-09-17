import { mintPlanetSceneLayers, searchPlanetScenes, type PlanetSceneSliceOut } from '~/api/client';
import type { Bbox, LonLat } from '~/shared/map/types';
import { squareAround } from '../campaign/annotation';
import { withSceneLayers, type ImageryCatalog } from '../campaign/imagery';
import { sceneSourceOf } from '../campaign/scenes';
import { metersPerPixel } from './pack';
import type { ViewCell } from './view';

/** The same search and mint the annotation page runs for its viewport, run around the
 *  task instead. A search is kept per extent, so the views an agent asks for next and
 *  the prerendered ones for the same task do not search Planet again. */

const MIN_SEARCH_METERS = 1000;
const MINT_BATCH = 64;
const CACHE_LIMIT = 50;

type Found = Map<number, PlanetSceneSliceOut>;
const searches = new Map<string, Promise<Found>>();

export interface TaskScenes {
  catalog: ImageryCatalog;
  /** Scene slices this view asked for that hold no imagery around the task. */
  empty: Set<number>;
  errors: string[];
}

export async function withTaskScenes(
  cat: ImageryCatalog,
  cells: ViewCell[],
  center: LonLat,
  defaultZoom: number,
  cellPx: number
): Promise<TaskScenes> {
  const bySource = new Map<number, { sliceIds: Set<number>; meters: number }>();
  for (const cell of cells) {
    if (cell.slice_id == null) continue;
    const collection = [...cat.collections.values()].find((c) =>
      c.slices.some((s) => s.id === cell.slice_id)
    );
    const source = collection && sceneSourceOf(cat, collection);
    if (!source) continue;
    const entry = bySource.get(source.id) ?? { sliceIds: new Set(), meters: MIN_SEARCH_METERS };
    entry.sliceIds.add(cell.slice_id);
    entry.meters = Math.max(
      entry.meters,
      metersPerPixel(center[1], cell.zoom ?? defaultZoom) * cellPx
    );
    bySource.set(source.id, entry);
  }

  let catalog = cat;
  const empty = new Set<number>();
  const errors: string[] = [];
  for (const [sourceId, { sliceIds, meters }] of bySource) {
    const source = cat.sources.get(sourceId)!;
    const vizName = source.visualizations[0]?.name;
    if (!vizName) continue;
    const box = bboxOf(squareAround(center, meters));
    const found = await search(cat.campaignId, sourceId, box);

    const unminted = [...sliceIds].filter((id) => found.has(id) && !found.get(id)!.layer_id);
    for (let i = 0; i < unminted.length; i += MINT_BATCH) {
      const { data } = await mintPlanetSceneLayers({
        path: { campaign_id: cat.campaignId, source_id: sourceId },
        body: { bbox: box, slice_ids: unminted.slice(i, i + MINT_BATCH) },
        throwOnError: true,
      });
      for (const slice of data.slices) found.set(slice.slice_id, slice);
      errors.push(...(data.errors ?? []));
    }

    for (const id of sliceIds) if (!found.get(id)?.layer_id) empty.add(id);
    catalog = withSceneLayers(catalog, sourceId, vizName, [...found.values()]);
  }
  return { catalog, empty, errors };
}

function search(campaignId: number, sourceId: number, box: Bbox): Promise<Found> {
  const key = `${sourceId}|${box.map((v) => v.toFixed(5)).join(',')}`;
  let pending = searches.get(key);
  if (!pending) {
    pending = searchPlanetScenes({
      path: { campaign_id: campaignId, source_id: sourceId },
      body: { bbox: box },
      throwOnError: true,
    }).then(({ data }) => new Map(data.slices.map((slice) => [slice.slice_id, slice])));
    pending.catch(() => searches.delete(key));
    searches.set(key, pending);
    if (searches.size > CACHE_LIMIT) searches.delete(searches.keys().next().value!);
  }
  return pending;
}

function bboxOf(polygon: GeoJSON.Polygon): Bbox {
  const ring = polygon.coordinates[0];
  const lons = ring.map(([lon]) => lon);
  const lats = ring.map(([, lat]) => lat);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}
