import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

/**
 * The parts every density map shares: following the viewport so the grid can resolve,
 * drawing a cell, and the legend that switches categories off.
 *
 * Three maps draw from a density grid - annotations by class, tasks by status, tasks by
 * the label an annotator gave them. They differ only in what they fetch and how a
 * category is coloured and named, so that is all their own files hold.
 */

/** Fraction of the viewport fetched beyond each edge, so a pan is usually already in. */
const PRELOAD_MARGIN = 0.5;

/**
 * Grid resolution across the *fetched* window, which the margin makes twice the
 * viewport in each direction - so the viewport itself sees about half this many cells.
 * Raised alongside the margin to pay for that, but not doubled: cell count is what
 * decides the response size, and these maps resolve to individual features by zooming
 * rather than by asking for a finer grid.
 */
export const TARGET_CELLS = 96;

/**
 * The window to fetch a grid for, as `minx,miny,maxx,maxy`, or null before the map has
 * settled. Cells are sized from it, so following the viewport is what makes zooming
 * resolve: cells shrink until one holds a single feature and its reported position is
 * that feature's own.
 */
export const useDensityViewport = (
  mapRef: React.MutableRefObject<L.Map | null>,
  mapReady: boolean
): string | null => {
  const [view, setView] = useState<string | null>(null);
  // What was actually fetched: a window wider than the viewport, and the zoom it was
  // built for. Panning inside it needs no request at all.
  const loadedRef = useRef<{ bounds: L.LatLngBounds; zoom: number } | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let timer: ReturnType<typeof setTimeout>;

    const sync = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const visible = map.getBounds();
        // A map that has not been laid out yet - a hidden tab, a collapsed panel -
        // reports NaN bounds, which would otherwise be sent as the window to fetch.
        if (
          ![visible.getWest(), visible.getSouth(), visible.getEast(), visible.getNorth()].every(
            Number.isFinite
          )
        ) {
          return;
        }
        const zoom = map.getZoom();
        const loaded = loadedRef.current;
        // Cell size is derived from the fetched window, so a zoom change always needs
        // a new grid; a pan only does once it leaves what was fetched.
        if (loaded && loaded.zoom === zoom && loaded.bounds.contains(visible)) return;

        const padded = visible.pad(PRELOAD_MARGIN);
        loadedRef.current = { bounds: padded, zoom };
        setView(
          [padded.getWest(), padded.getSouth(), padded.getEast(), padded.getNorth()]
            .map((n) => n.toFixed(5))
            .join(',')
        );
      }, 200);
    };

    sync();
    map.on('moveend zoomend', sync);
    return () => {
      clearTimeout(timer);
      map.off('moveend zoomend', sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mapRef is stable
  }, [mapReady]);

  return view;
};

/** A category key: whatever the map splits its cells by, such as a status or a label id. */
export type DensityKey = string | number;

export interface DensityPoint<K extends DensityKey> {
  lon: number;
  lat: number;
  count: number;
  key: K;
}

/** Draw one grid's worth of cells, largest first so a big group never hides a small one. */
export const drawDensityCells = <K extends DensityKey>(
  layer: L.LayerGroup,
  points: DensityPoint<K>[],
  colorOf: (key: K) => string,
  nameOf: (key: K) => string
): void => {
  layer.clearLayers();
  if (points.length === 0) return;

  const busiest = Math.max(...points.map((p) => p.count));

  [...points]
    .sort((a, b) => b.count - a.count)
    .forEach((cell) => {
      const single = cell.count === 1;
      const marker = L.circleMarker([cell.lat, cell.lon], {
        // Area tracks the count, not radius - radius exaggerates it badly. A cell
        // holding one feature is drawn at a fixed small size: it is a point now, not a
        // cluster, and scaling it by its share would make it vanish.
        radius: single ? 5 : 6 + 14 * Math.sqrt(cell.count / busiest),
        color: '#ffffff',
        weight: 1,
        fillColor: colorOf(cell.key),
        fillOpacity: single ? 0.9 : 0.55,
        // Leaflet focuses an SVG path on click, which leaves a stray outline on a
        // shape that has nothing to focus into.
        bubblingMouseEvents: false,
        interactive: true,
      });
      marker.bindTooltip(
        single
          ? `<span class="capitalize">${nameOf(cell.key)}</span>`
          : `<span class="capitalize">${nameOf(cell.key)}</span> &middot; ${cell.count.toLocaleString()} here`,
        { direction: 'top' }
      );
      layer.addLayer(marker);
    });
};

/** The categories switched off on a map, and a toggle for them. */
export const useHiddenKeys = <K extends DensityKey>() => {
  const [hidden, setHidden] = useState<ReadonlySet<K>>(new Set<K>());
  const toggle = (key: K) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return { hidden, toggle };
};
