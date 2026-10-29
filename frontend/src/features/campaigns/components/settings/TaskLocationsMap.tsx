import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getTaskDensityOptions } from '~/api/queries';
import {
  formatTaskStatus,
  TASK_STATUS_CONFIG,
  TASK_STATUSES,
  type TaskStatus,
} from '~/shared/utils/taskStatus';
import { DensityLegend } from '../review/DensityLegend';
import {
  DensityMap,
  TARGET_CELLS,
  useDensityMap,
  useHiddenKeys,
  type AreaBounds,
} from '../review/densityMap';

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
  bbox: AreaBounds;
}

const UNKNOWN_STATUS_COLOR = '#6B7280';

export const TaskLocationsMap: React.FC<TaskLocationsMapProps> = memo(
  ({ statusCounts, totalTasks, taskSetId, campaignId, bbox }) => {
    const { t } = useTranslation('campaigns');
    const { camera, view } = useDensityMap(bbox);
    const { hidden, toggle } = useHiddenKeys<TaskStatus>();
    const { data: cells = [] } = useQuery({
      ...getTaskDensityOptions({
        path: { campaign_id: campaignId },
        query: { bbox: view ?? '', target_cells: TARGET_CELLS, task_set_id: taskSetId },
      }),
      enabled: view !== null,
      placeholderData: keepPreviousData,
      meta: { errorMessage: t('errors.loadTaskLocations') },
    });
    // One dot per cell per status, so a cell holding both shows both.
    const points = cells
      .filter((cell) => !hidden.has(cell.task_status))
      .map((cell) => ({ lon: cell.lon, lat: cell.lat, count: cell.count, key: cell.task_status }));

    const legend = TASK_STATUSES.map((status) => ({
      key: status,
      name: formatTaskStatus(status),
      color: TASK_STATUS_CONFIG[status].color,
      count: statusCounts[status] ?? 0,
    })).filter((entry) => entry.count > 0 || entry.key === 'pending');

    return (
      <div>
        <h2 className="text-lg font-semibold text-neutral-900 mb-4">
          {t('taskLocations.title', { count: totalTasks })}
        </h2>

        <DensityLegend entries={legend} hidden={hidden} onToggle={toggle} />

        <DensityMap
          camera={camera}
          area={bbox}
          points={points}
          colorOf={(status) => TASK_STATUS_CONFIG[status]?.color ?? UNKNOWN_STATUS_COLOR}
          nameOf={formatTaskStatus}
          className="w-full h-80 rounded-lg border border-neutral-200"
        />
      </div>
    );
  }
);

TaskLocationsMap.displayName = 'TaskLocationsMap';
