import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  getAnnotationDensityByLabel,
  type AnnotationLabelDensityCell,
  type LabelBase,
  type LabelFacet,
} from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';
import { generateLabelColors } from './labelColors';
import { useLeafletMap } from './useLeafletMap';

/**
 * Where each class sits across the whole campaign.
 *
 * Aggregated into a coarse grid in the database, one row per cell per class, so the
 * payload grows with cells times classes rather than with the number of annotations -
 * and so the picture is the campaign's own, independent of whatever page the table
 * happens to be showing.
 *
 * The previous version placed one Leaflet DOM marker per annotation. At 100k that is
 * 100k DOM nodes, and it needed every geometry shipped to the browser to build them.
 *
 * The campaign pages have three maps and they answer different questions:
 *   - this one            - annotations, by class, aggregated in the database
 *   - `TasksByLabelMap`   - tasks, by the label an annotator gave them
 *   - `TaskLocationsMap`  - tasks, by task status
 * Only this one aggregates; the other two still place a marker per task, which is
 * fine at task counts and not at annotation counts.
 */
interface ClassDistributionMapProps {
  campaignId: number;
  /** Campaign-wide counts per class, for the legend. */
  labelCounts: LabelFacet[];
  labels: LabelBase[];
  bbox: { west: number; south: number; east: number; north: number };
}

const NO_LABEL_COLOR = '#9CA3AF';
const NO_LABEL_KEY = -1;
/** Fraction of the viewport fetched beyond each edge, so a pan is usually already in. */
const PRELOAD_MARGIN = 0.5;
/**
 * Grid resolution across the *fetched* window, which the margin makes twice the
 * viewport in each direction - so the viewport itself sees about half this many cells.
 * Raised alongside the margin to pay for that, but not doubled: cell count is what
 * decides the response size, and the map resolves to individual annotations by zooming
 * rather than by asking for a finer grid.
 */
const TARGET_CELLS = 96;

export const ClassDistributionMap: React.FC<ClassDistributionMapProps> = ({
  campaignId,
  labelCounts,
  labels,
  bbox,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mapRef, markersLayerRef, mapReady } = useLeafletMap(containerRef, bbox);
  const [labelColors, setLabelColors] = useState<Record<number, string>>({});
  const [cells, setCells] = useState<AnnotationLabelDensityCell[]>([]);
  // The window the grid was last built for. Cells are sized from it, so following the
  // viewport is what makes zooming resolve: cells shrink until one holds a single
  // annotation and its reported centroid is that annotation's own position.
  const [view, setView] = useState<string | null>(null);
  // Classes switched off in the legend. Empty means every class is drawn.
  const [hidden, setHidden] = useState<Set<number>>(new Set());

  useEffect(() => {
    setLabelColors(generateLabelColors(labels));
  }, [labels]);

  // What was actually fetched: a window wider than the viewport, and the zoom it was
  // built for. Panning inside it needs no request at all.
  const loadedRef = useRef<{ bounds: L.LatLngBounds; zoom: number } | null>(null);

  // Track the viewport, coalescing the rapid moveend bursts a drag produces.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let timer: ReturnType<typeof setTimeout>;

    const sync = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const visible = map.getBounds();
        const zoom = map.getZoom();
        const loaded = loadedRef.current;
        // Cell size is derived from the fetched window, so a zoom change always needs
        // a new grid; a pan only does once it leaves what was fetched.
        if (loaded && loaded.zoom === zoom && loaded.bounds.contains(visible)) return;

        // Half a screen of margin on each side: enough that ordinary panning is
        // already loaded, small enough that the grid stays near the viewport's own
        // resolution rather than being coarsened by a much larger window.
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

  useEffect(() => {
    if (!view) return;
    let cancelled = false;
    getAnnotationDensityByLabel({
      path: { campaign_id: campaignId },
      query: { bbox: view, target_cells: TARGET_CELLS },
    })
      .then((res) => {
        if (!cancelled) setCells(res.data ?? []);
      })
      .catch((err) => {
        if (!cancelled) handleError(err, 'Failed to load annotation distribution');
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, view]);

  const keyOf = (labelId: number | null) => labelId ?? NO_LABEL_KEY;
  const colorOf = (labelId: number | null) =>
    labelId === null ? NO_LABEL_COLOR : (labelColors[labelId] ?? NO_LABEL_COLOR);
  const nameOf = (labelId: number | null) =>
    labelId === null
      ? 'No label'
      : (labels.find((l) => l.id === labelId)?.name ?? `Label #${labelId}`);

  const visible = useMemo(
    () => cells.filter((c) => !hidden.has(keyOf(c.label_id))),
    [cells, hidden]
  );

  useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current || !mapReady) return;

    markersLayerRef.current.clearLayers();
    if (visible.length === 0) return;

    const busiest = Math.max(...visible.map((c) => c.count));

    // Largest first, so a big class never covers a small one sharing its cell.
    [...visible]
      .sort((a, b) => b.count - a.count)
      .forEach((cell) => {
        const share = cell.count / busiest;
        const single = cell.count === 1;
        const marker = L.circleMarker([cell.lat, cell.lon], {
          // Area tracks the count, not radius - radius exaggerates it badly. A cell
          // holding one annotation is drawn at a fixed small size: it is a point now,
          // not a cluster, and scaling it by "share" would make it vanish.
          radius: single ? 5 : 6 + 14 * Math.sqrt(share),
          color: '#ffffff',
          weight: 1,
          fillColor: colorOf(cell.label_id),
          fillOpacity: single ? 0.9 : 0.55,
          // Leaflet focuses an SVG path on click, which leaves a stray outline on a
          // shape that has nothing to focus into.
          bubblingMouseEvents: false,
          interactive: true,
        });
        marker.bindTooltip(
          single
            ? `<span class="capitalize">${nameOf(cell.label_id)}</span>`
            : `<span class="capitalize">${nameOf(cell.label_id)}</span> &middot; ${cell.count.toLocaleString()} here`,
          { direction: 'top' }
        );
        markersLayerRef.current?.addLayer(marker);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map refs are stable, from useLeafletMap
  }, [visible, mapReady, labelColors, labels]);

  const toggle = (key: number) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const legend = [
    ...labels.map((label) => ({
      key: label.id,
      name: label.name,
      color: labelColors[label.id],
      count: labelCounts.find((c) => c.label_id === label.id)?.count ?? 0,
    })),
    {
      key: NO_LABEL_KEY,
      name: 'No label',
      color: NO_LABEL_COLOR,
      count: labelCounts.find((c) => c.label_id === null)?.count ?? 0,
    },
  ].filter((entry) => entry.count > 0);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3 text-sm">
        {legend.map(({ key, name, color, count }) => {
          const off = hidden.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              aria-pressed={!off}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 transition-colors ${
                off
                  ? 'border-neutral-200 text-neutral-400'
                  : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'
              }`}
              title={off ? `Show ${name}` : `Hide ${name}`}
            >
              <span
                className="w-3.5 h-3.5 rounded-full border-2 border-white"
                style={{
                  backgroundColor: color,
                  opacity: off ? 0.3 : 1,
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.1)',
                }}
              />
              <span className="capitalize">
                {name} ({count.toLocaleString()})
              </span>
            </button>
          );
        })}
      </div>

      <div ref={containerRef} className="w-full h-96 rounded-lg border border-neutral-200" />
    </div>
  );
};
