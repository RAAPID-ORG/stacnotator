import { useState } from 'react';
import { searchPlanetScenes, type ImageryCollectionOut, type ImagerySourceOut } from '~/api/client';
import { planetLayerProxyUrl } from '~/shared/imagery/tileUrls';
import { handleError } from '~/shared/utils/errorHandler';
import { useCampaignStore, useCatalog } from '../../stores/campaign';
import { mainCamera } from '../../map/camera';
import type { ImageryCatalog } from '../../campaign/imagery';

/**
 * The source behind a collection when its imagery is found rather than registered:
 * its slices are dates with nothing behind them until someone searches from where
 * they are standing. Null for every other kind, which needs no button.
 */
export function sceneSourceOf(
  catalog: ImageryCatalog,
  collection: ImageryCollectionOut
): ImagerySourceOut | null {
  const source = catalog.sources.get(catalog.sourceOf.get(collection.id) ?? -1);
  const isScenes = (source?.generation_series ?? []).some(
    (series) => series.config.kind === 'planet_scenes'
  );
  return isScenes ? (source ?? null) : null;
}

export interface SceneSearch {
  run: () => void;
  searching: boolean;
  /** Dates found by the last search, or null before one has run. */
  found: number | null;
}

/**
 * Search Planet for what covers the main map right now.
 *
 * The extent is the question: a scene is about 25 km across, so which dates hold
 * imagery depends entirely on where the annotator is, and moving somewhere else makes
 * the answer stale. Nothing is stored - the result lives in this page's catalog until
 * the next search replaces it.
 */
export function useSceneSearch(source: ImagerySourceOut): SceneSearch {
  const catalog = useCatalog();
  const applySceneSearch = useCampaignStore((s) => s.applySceneSearch);
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<number | null>(null);

  const run = () => {
    const vizName = source.visualizations[0]?.name;
    if (!vizName || searching) return;
    setSearching(true);
    void searchPlanetScenes({
      path: { campaign_id: catalog.campaignId, source_id: source.id },
      body: { bbox: mainCamera.getBounds() },
    })
      .then(({ data }) => {
        const slices = data?.slices ?? [];
        applySceneSearch(
          source.id,
          vizName,
          new Map(
            slices.map((slice) => [
              slice.slice_id,
              planetLayerProxyUrl(catalog.campaignId, source.id, slice.layer_id),
            ])
          )
        );
        setFound(slices.length);
        // Planet refusing one slice still leaves the others usable, so this reports
        // rather than throws away what came back.
        for (const message of data?.errors ?? []) handleError(new Error(message), message);
      })
      .catch((err) => handleError(err, 'Could not search Planet for scenes here'))
      .finally(() => setSearching(false));
  };

  return { run, searching, found };
}
