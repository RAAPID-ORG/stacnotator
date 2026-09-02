import type { ImageryCollectionOut, ImagerySourceOut, ImageryViewOut } from '~/api/client';
import type { Bbox, LonLat } from '~/shared/map/types';
import type { ImageryCatalog } from './imagery';

/**
 * Scene sources - imagery that is found rather than registered.
 *
 * A campaign area can be a country, and one Planet scene is about 25 km across, so
 * nothing is searched when the source is set up: its slices are dates with nothing
 * behind them until a search over where the annotator is standing mints a layer per
 * date. What is left to decide is which box to search and whether the last search
 * still covers the screen, which is all this file.
 */

const isSceneSource = (source: ImagerySourceOut): boolean =>
  (source.generation_series ?? []).some((series) => series.config.kind === 'planet_scenes');

/** The source behind a collection when it is one of those, else null - which is what
 *  keeps the load control off every other kind of imagery. */
export function sceneSourceOf(
  catalog: ImageryCatalog,
  collection: ImageryCollectionOut
): ImagerySourceOut | null {
  const source = catalog.sources.get(catalog.sourceOf.get(collection.id) ?? -1);
  return source && isSceneSource(source) ? source : null;
}

/** Scene sources the page is currently browsing. */
export function sceneSourcesInView(
  catalog: ImageryCatalog,
  view: Pick<ImageryViewOut, 'source_ids'> | null
): ImagerySourceOut[] {
  const ids = view ? view.source_ids : [...catalog.sources.keys()];
  const out: ImagerySourceOut[] = [];
  for (const id of ids) {
    const source = catalog.sources.get(id);
    if (source && isSceneSource(source)) out.push(source);
  }
  return out;
}

/** How much wider than the screen a search reaches. Slack, so that nudging the map
 *  does not cost another search, and so imagery reaches the edges while panning. */
export const SEARCH_MARGIN = 1.5;

export function searchBox(view: Bbox, margin = SEARCH_MARGIN): Bbox {
  const halfWidth = ((view[2] - view[0]) * margin) / 2;
  const halfHeight = ((view[3] - view[1]) * margin) / 2;
  const [lon, lat] = [(view[0] + view[2]) / 2, (view[1] + view[3]) / 2];
  return [lon - halfWidth, lat - halfHeight, lon + halfWidth, lat + halfHeight];
}

/** The same span somewhere else: what the screen will cover once the map moves to
 *  `center`, which is how the next task's imagery is fetched before it is shown. */
export function boxAround(center: LonLat, like: Bbox): Bbox {
  const halfWidth = (like[2] - like[0]) / 2;
  const halfHeight = (like[3] - like[1]) / 2;
  return [
    center[0] - halfWidth,
    center[1] - halfHeight,
    center[0] + halfWidth,
    center[1] + halfHeight,
  ];
}

export const covers = (outer: Bbox, inner: Bbox): boolean =>
  outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];

/**
 * Below this the screen holds more archive than a search should ask for: the search
 * runs once per date, and a view a country wide answers each of them with tens of
 * thousands of scenes that no single layer could draw anyway.
 */
export const MIN_SCENE_ZOOM = 10;
