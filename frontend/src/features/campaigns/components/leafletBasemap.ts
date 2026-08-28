import type L from 'leaflet';
import { BASEMAP_STYLE_URL } from '~/shared/imagery/tileUrls';

/**
 * Draws the shared backdrop under a Leaflet map.
 *
 * maplibre is around 1MB and only these few admin maps render with it, so it is
 * fetched when one mounts. Imported at the top of a component instead, it lands
 * in a shared chunk and every route that touches that chunk pays for it.
 */
export function addGlBasemap(map: L.Map): void {
  void import('@maplibre/maplibre-gl-leaflet').then(({ maplibreGL }) => {
    // The map may have been torn down while maplibre was still loading.
    if (!map.getContainer().isConnected) return;
    maplibreGL({ style: BASEMAP_STYLE_URL }).addTo(map);
  });
}
