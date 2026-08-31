import type L from 'leaflet';
// maplibre builds its worker URL from its own module URL at runtime, which no
// bundler can follow: the file is never emitted and the built app loads a style
// but no tiles. Vite bundles the worker here instead, and the URL is handed back
// to maplibre before the first map is created.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { BASEMAP_STYLE_URL } from '~/shared/imagery/tileUrls';

/**
 * Draws the shared backdrop under a Leaflet map.
 *
 * maplibre is around 1MB and only these few admin maps render with it, so it is
 * fetched when one mounts. Imported at the top of a component instead, it lands
 * in a shared chunk and every route that touches that chunk pays for it.
 */
export function addGlBasemap(map: L.Map): void {
  void Promise.all([import('@maplibre/maplibre-gl-leaflet'), import('maplibre-gl')]).then(
    ([{ maplibreGL }, { setWorkerUrl }]) => {
      // The map may have been torn down while maplibre was still loading.
      if (!map.getContainer().isConnected) return;
      setWorkerUrl(workerUrl);
      maplibreGL({ style: BASEMAP_STYLE_URL }).addTo(map);
    }
  );
}
