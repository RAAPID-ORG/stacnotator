import { memo, useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { getTaskDensity, type TaskDensityCell } from '~/api/client';
import {
  formatTaskStatus,
  TASK_STATUS_CONFIG,
  TASK_STATUSES,
  type TaskStatus,
} from '~/shared/utils/taskStatus';
import { handleError } from '~/shared/utils/errorHandler';
import { DensityLegend } from '../review/DensityLegend';
import {
  drawDensityCells,
  TARGET_CELLS,
  useDensityViewport,
  useHiddenKeys,
} from '../review/densityMap';
import { useLeafletMap } from '../review/useLeafletMap';

/**
 * Where a campaign's tasks are, by status.
 *
 * Aggregated into a grid in the database, so the payload grows with cells rather than
 * with the number of tasks and the picture does not depend on the page the table below
 * happens to be showing. Zooming in shrinks the cells until one holds a single task,
 * which is drawn at that task's own position.
 */
interface TaskLocationsMapProps {
  /** Campaign-wide count per status, for the legend and the heading. */
  statusCounts: Record<TaskStatus, number>;
  totalTasks: number;
  /** Restricts the grid to one task set, matching the scope bar above. */
  taskSetId?: number;
  campaignId: number;
  bbox: { west: number; south: number; east: number; north: number };
}

const UNKNOWN_STATUS_COLOR = '#6B7280';

export const TaskLocationsMap: React.FC<TaskLocationsMapProps> = memo(
  ({ statusCounts, totalTasks, taskSetId, campaignId, bbox }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { mapRef, markersLayerRef, mapReady } = useLeafletMap(containerRef, bbox);
    const view = useDensityViewport(mapRef, mapReady);
    const [cells, setCells] = useState<TaskDensityCell[]>([]);
    const { hidden, toggle } = useHiddenKeys<TaskStatus>();

    useEffect(() => {
      if (!view) return;
      let cancelled = false;
      getTaskDensity({
        path: { campaign_id: campaignId },
        query: { bbox: view, target_cells: TARGET_CELLS, task_set_id: taskSetId },
      })
        .then((res) => {
          if (!cancelled) setCells(res.data ?? []);
        })
        .catch((err) => {
          if (!cancelled) handleError(err, 'Failed to load task locations');
        });
      return () => {
        cancelled = true;
      };
    }, [campaignId, taskSetId, view]);

    useEffect(() => {
      if (!markersLayerRef.current || !mapReady) return;
      // One dot per cell per status, so a cell holding both shows both.
      const points = cells
        .filter((cell) => !hidden.has(cell.task_status))
        .map((cell) => ({
          lon: cell.lon,
          lat: cell.lat,
          count: cell.count,
          key: cell.task_status,
        }));
      drawDensityCells(
        markersLayerRef.current,
        points,
        (status) => TASK_STATUS_CONFIG[status]?.color ?? UNKNOWN_STATUS_COLOR,
        formatTaskStatus
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps -- map refs are stable, from useLeafletMap
    }, [cells, hidden, mapReady]);

    const legend = TASK_STATUSES.map((status) => ({
      key: status,
      name: TASK_STATUS_CONFIG[status].label,
      color: TASK_STATUS_CONFIG[status].color,
      count: statusCounts[status] ?? 0,
    })).filter((entry) => entry.count > 0 || entry.key === 'pending');

    return (
      <div>
        <h2 className="text-lg font-semibold text-neutral-900 mb-4">
          Task Locations ({totalTasks} total)
        </h2>

        <DensityLegend entries={legend} hidden={hidden} onToggle={toggle} />

        <div ref={containerRef} className="w-full h-80 rounded-lg border border-neutral-200" />
      </div>
    );
  }
);

TaskLocationsMap.displayName = 'TaskLocationsMap';
