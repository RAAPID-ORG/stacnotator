import { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import {
  getAnnotationDensityByLabel,
  type AnnotationLabelDensityCell,
  type LabelBase,
  type LabelFacet,
} from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';
import { DensityLegend } from './DensityLegend';
import { drawDensityCells, TARGET_CELLS, useDensityViewport, useHiddenKeys } from './densityMap';
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
 *   - this one            - annotations, by class
 *   - `TasksByLabelMap`   - tasks, by the label an annotator gave them
 *   - `TaskLocationsMap`  - tasks, by task status
 * All three read a density grid and share their viewport following, cell drawing and
 * legend from `densityMap`; only what they fetch and how a category is coloured differs.
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

export const ClassDistributionMap: React.FC<ClassDistributionMapProps> = ({
  campaignId,
  labelCounts,
  labels,
  bbox,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mapRef, markersLayerRef, mapReady } = useLeafletMap(containerRef, bbox);
  const view = useDensityViewport(mapRef, mapReady);
  const [labelColors, setLabelColors] = useState<Record<number, string>>({});
  const [cells, setCells] = useState<AnnotationLabelDensityCell[]>([]);
  const { hidden, toggle } = useHiddenKeys<number>();

  useEffect(() => {
    setLabelColors(generateLabelColors(labels));
  }, [labels]);

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
    () =>
      cells
        .map((cell) => ({
          lon: cell.lon,
          lat: cell.lat,
          count: cell.count,
          key: keyOf(cell.label_id),
        }))
        .filter((point) => !hidden.has(point.key)),
    [cells, hidden]
  );

  useEffect(() => {
    if (!markersLayerRef.current || !mapReady) return;
    drawDensityCells(
      markersLayerRef.current,
      visible,
      (key) => colorOf(key === NO_LABEL_KEY ? null : key),
      (key) => nameOf(key === NO_LABEL_KEY ? null : key)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map refs are stable, from useLeafletMap
  }, [visible, mapReady, labelColors, labels]);

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
      <DensityLegend entries={legend} hidden={hidden} onToggle={toggle} />

      <div ref={containerRef} className="w-full h-96 rounded-lg border border-neutral-200" />
    </div>
  );
};
