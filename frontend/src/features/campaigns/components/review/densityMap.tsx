import { useEffect, useMemo, useRef, useState } from 'react';
import { asArray } from 'ol/color';
import i18n from '~/shared/i18n';
import { BASEMAP_STYLE_URL } from '~/shared/imagery/tileUrls';
import { Camera } from '~/shared/map/Camera';
import { MapView } from '~/shared/map/MapView';
import type { Bbox, LayerSpec } from '~/shared/map/types';

const t = i18n.getFixedT(null, 'review');

/**
 * The parts every density map shares: following the viewport so the grid can resolve,
 * drawing the cells, and the legend that switches categories off.
 *
 * Two maps draw from a density grid - annotations by class, tasks by status. They
 * differ only in what they fetch and how a category is coloured and named, so that is
 * all their own files hold.
 */

/** Fraction of the viewport fetched beyond each edge, so a pan is usually already in. */
const PRELOAD_MARGIN = 0.5;
const SETTLE_MS = 200;

/**
 * Grid resolution across the *fetched* window, which the margin makes twice the
 * viewport in each direction - so the viewport itself sees about half this many cells.
 * Raised alongside the margin to pay for that, but not doubled: cell count is what
 * decides the response size, and these maps resolve to individual features by zooming
 * rather than by asking for a finer grid.
 */
export const TARGET_CELLS = 96;

export interface AreaBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

const pad = ([w, s, e, n]: Bbox, fraction: number): Bbox => {
  const dx = (e - w) * fraction;
  const dy = (n - s) * fraction;
  return [w - dx, s - dy, e + dx, n + dy];
};

const contains = (outer: Bbox, inner: Bbox) =>
  outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];

/**
 * The map's camera, framed on the campaign area, and the window to fetch a grid for as
 * `minx,miny,maxx,maxy` (null before the map has settled). Cells are sized from that
 * window, so following the viewport is what makes zooming resolve: cells shrink until
 * one holds a single feature and its reported position is that feature's own.
 */
export const useDensityMap = (area: AreaBounds): { camera: Camera; view: string | null } => {
  const camera = useRef<Camera>(null);
  camera.current ??= new Camera({
    center: [(area.west + area.east) / 2, (area.south + area.north) / 2],
    zoom: 10,
  });
  const [view, setView] = useState<string | null>(null);
  // What was actually fetched: a window wider than the viewport, and the zoom it was
  // built for. Panning inside it needs no request at all.
  const loaded = useRef<{ bounds: Bbox; zoom: number } | null>(null);

  useEffect(() => {
    camera.current?.fitBounds([area.west, area.south, area.east, area.north], {
      paddingPx: 20,
    });
  }, [area.west, area.south, area.east, area.north]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = camera.current!.onChange(({ bounds, zoom }) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!bounds.every(Number.isFinite)) return;
        const last = loaded.current;
        // Cell size is derived from the fetched window, so a zoom change always needs
        // a new grid; a pan only does once it leaves what was fetched.
        if (last && last.zoom === zoom && contains(last.bounds, bounds)) return;
        const padded = pad(bounds, PRELOAD_MARGIN);
        loaded.current = { bounds: padded, zoom };
        setView(padded.map((n) => n.toFixed(5)).join(','));
      }, SETTLE_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return { camera: camera.current, view };
};

/** A category key: whatever the map splits its cells by, such as a status or a label id. */
export type DensityKey = string | number;

export interface DensityPoint<K extends DensityKey> {
  lon: number;
  lat: number;
  count: number;
  key: K;
}

const withAlpha = (color: string, alpha: number) => {
  const [r, g, b] = asArray(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const BASEMAP: LayerSpec = { kind: 'gl-style', id: 'density-basemap', styleUrl: BASEMAP_STYLE_URL };
const CELLS_LAYER = 'density-cells';

/** One grid's worth of cells over the campaign area, with the hovered cell named. */
export const DensityMap = <K extends DensityKey>({
  camera,
  area,
  points,
  colorOf,
  nameOf,
  className,
}: {
  camera: Camera;
  area: AreaBounds;
  points: DensityPoint<K>[];
  colorOf: (key: K) => string;
  nameOf: (key: K) => string;
  className: string;
}) => {
  const [hovered, setHovered] = useState<number | null>(null);
  // Largest first, so a big group never hides a small one drawn after it.
  const sorted = useMemo(() => [...points].sort((a, b) => b.count - a.count), [points]);
  const busiest = sorted[0]?.count ?? 1;

  const layers: LayerSpec[] = [
    BASEMAP,
    {
      kind: 'features',
      id: 'density-area',
      features: [
        {
          id: 'area',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [area.west, area.south],
                [area.east, area.south],
                [area.east, area.north],
                [area.west, area.north],
                [area.west, area.south],
              ],
            ],
          },
        },
      ],
      style: {
        stroke: { color: '#326247', width: 2, dash: [5, 5] },
        fill: { color: 'rgba(50, 98, 71, 0.05)' },
      },
      zIndex: 1,
    },
    {
      kind: 'features',
      id: CELLS_LAYER,
      features: sorted.map((cell, index) => ({
        id: index,
        geometry: { type: 'Point', coordinates: [cell.lon, cell.lat] },
      })),
      style: (feature) => {
        const cell = sorted[Number(feature.id)];
        const single = cell.count === 1;
        return {
          circle: {
            // Area tracks the count, not radius - radius exaggerates it badly. A cell
            // holding one feature is drawn at a fixed small size: it is a point now,
            // not a cluster, and scaling it by its share would make it vanish.
            radius: single ? 5 : 6 + 14 * Math.sqrt(cell.count / busiest),
            stroke: { color: '#ffffff', width: 1 },
            fill: { color: withAlpha(colorOf(cell.key), single ? 0.9 : 0.55) },
          },
        };
      },
      zIndex: 2,
    },
  ];

  const hoveredCell = hovered === null ? undefined : sorted[hovered];

  return (
    <div className={`${className} overflow-hidden`}>
      <MapView
        camera={camera}
        layers={layers}
        onHoverFeature={(hit) =>
          setHovered(hit?.layerId === CELLS_LAYER ? Number(hit.featureId) : null)
        }
        anchor={
          hoveredCell
            ? {
                at: [hoveredCell.lon, hoveredCell.lat],
                offset: [8, -28],
                content: (
                  <div className="pointer-events-none whitespace-nowrap rounded bg-white px-2 py-1 text-xs text-neutral-800 shadow">
                    <span>{nameOf(hoveredCell.key)}</span>
                    {hoveredCell.count > 1 &&
                      ` · ${t('densityMap.countHere', { n: hoveredCell.count.toLocaleString() })}`}
                  </div>
                ),
              }
            : null
        }
      />
    </div>
  );
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
