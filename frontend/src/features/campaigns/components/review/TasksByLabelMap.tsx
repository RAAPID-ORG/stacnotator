import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { getTaskDensity, type LabelBase, type TaskDensityCell } from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';
import { DensityLegend } from './DensityLegend';
import { drawDensityCells, TARGET_CELLS, useDensityViewport, useHiddenKeys } from './densityMap';
import { generateLabelColors } from './labelColors';
import { useLeafletMap } from './useLeafletMap';

/**
 * Task locations coloured by the label an annotator gave them.
 *
 * Sibling to `settings/TaskLocationsMap`, which draws the same grid coloured by task
 * *status*. Same points, different question - which is the only reason both exist.
 * Distinct again from `ClassDistributionMap`, which plots annotations rather than tasks.
 *
 * All three read a density grid built in the database, so the payload grows with cells
 * rather than with the size of the campaign, and all three share the viewport
 * following, cell drawing and legend in `densityMap`.
 */
interface TasksByLabelMapProps {
  campaignId: number;
  /** Campaign-wide counts, for the legend and the heading. */
  labelCounts: { labelId: number | null; count: number }[];
  pendingCount: number;
  skippedCount: number;
  totalTasks: number;
  labels: LabelBase[];
  bbox: { west: number; south: number; east: number; north: number };
}

const PENDING_COLOR = '#9CA3AF';
const SKIPPED_COLOR = '#8B5CF6';
/** Legend keys for the two states that are not a label. */
const PENDING_KEY = 'pending';
const SKIPPED_KEY = 'skipped';

/** What colours a cell: the label an annotator gave it, or the state it is still in. */
const cellKey = (cell: TaskDensityCell): string | number => {
  if (cell.label_id !== null) return cell.label_id;
  return cell.task_status === 'skipped' ? SKIPPED_KEY : PENDING_KEY;
};

export const TasksByLabelMap: React.FC<TasksByLabelMapProps> = ({
  campaignId,
  labelCounts,
  pendingCount,
  skippedCount,
  totalTasks,
  labels,
  bbox,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mapRef, markersLayerRef, mapReady } = useLeafletMap(containerRef, bbox);
  const view = useDensityViewport(mapRef, mapReady);
  const [cells, setCells] = useState<TaskDensityCell[]>([]);
  const [labelColors, setLabelColors] = useState<Record<number, string>>({});
  const { hidden, toggle } = useHiddenKeys<string | number>();

  useEffect(() => {
    setLabelColors(generateLabelColors(labels));
  }, [labels]);

  useEffect(() => {
    if (!view) return;
    let cancelled = false;
    getTaskDensity({
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

  const colorOf = (key: string | number) => {
    if (key === PENDING_KEY) return PENDING_COLOR;
    if (key === SKIPPED_KEY) return SKIPPED_COLOR;
    return labelColors[key as number] ?? PENDING_COLOR;
  };
  const nameOf = (key: string | number) => {
    if (key === PENDING_KEY) return 'Pending';
    if (key === SKIPPED_KEY) return 'Skipped';
    return labels.find((l) => l.id === key)?.name ?? `Label #${key}`;
  };

  useEffect(() => {
    if (!markersLayerRef.current || !mapReady) return;
    const points = cells
      .map((cell) => ({
        lon: cell.lon,
        lat: cell.lat,
        count: cell.count,
        key: cellKey(cell),
      }))
      .filter((point) => !hidden.has(point.key));
    drawDensityCells(markersLayerRef.current, points, colorOf, nameOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map refs are stable, from useLeafletMap
  }, [cells, hidden, mapReady, labelColors, labels]);

  const legend = [
    ...labels.map((label) => ({
      key: label.id as string | number,
      name: label.name,
      color: labelColors[label.id],
      count: labelCounts.find((c) => c.labelId === label.id)?.count ?? 0,
    })),
    { key: PENDING_KEY, name: 'Pending', color: PENDING_COLOR, count: pendingCount },
    { key: SKIPPED_KEY, name: 'Skipped', color: SKIPPED_COLOR, count: skippedCount },
  ].filter((entry) => entry.count > 0);

  return (
    <div className="bg-white rounded-lg border border-neutral-300 p-6">
      <h2 className="text-lg font-semibold text-neutral-900 mb-4">
        Annotation Distribution ({totalTasks} total)
      </h2>

      <DensityLegend entries={legend} hidden={hidden} onToggle={toggle} />

      <div ref={containerRef} className="w-full h-96 rounded-lg border border-neutral-200" />
    </div>
  );
};
