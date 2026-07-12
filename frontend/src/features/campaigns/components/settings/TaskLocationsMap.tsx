import { memo, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AnnotationTaskOut } from '~/api/client';
import { formatTaskStatus, TASK_STATUS_CONFIG } from '~/shared/utils/taskStatus';
import { extractCentroidFromWKT } from '~/shared/utils/utility';
import { useLeafletMap } from '../review/useLeafletMap';

interface TaskLocationsMapProps {
  tasks: AnnotationTaskOut[];
  bbox: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
}

export const TaskLocationsMap: React.FC<TaskLocationsMapProps> = memo(({ tasks, bbox }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mapRef, markersLayerRef, mapReady } = useLeafletMap(containerRef, bbox);

  // Update markers when tasks change
  useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current || !mapReady) return;

    // Clear existing markers
    markersLayerRef.current.clearLayers();

    // Add markers for each task
    tasks.forEach((task) => {
      const centroid = extractCentroidFromWKT(task.geometry.geometry);
      if (!centroid) return;
      const coords: [number, number] = [centroid.lat, centroid.lon];

      const taskStatus = task.task_status ?? 'pending';
      const statusColor = TASK_STATUS_CONFIG[taskStatus]?.color ?? '#6B7280';

      const icon = L.divIcon({
        html: `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="6" fill="${statusColor}" stroke="white" stroke-width="2"/>
          </svg>
        `,
        className: 'task-marker',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });

      const marker = L.marker(coords, { icon });

      // Add popup with task info
      const assignments = task.assignments || [];
      const assignedTo =
        assignments.length > 0 ? assignments.map((a) => a.user_id).join(', ') : 'Unassigned';

      marker.bindPopup(`
        <div class="text-sm">
          <div class="font-medium">Task #${task.annotation_number}</div>
          <div class="text-neutral-500">Status: ${formatTaskStatus(taskStatus)}</div>
          <div class="text-neutral-500">Assigned: ${assignedTo}</div>
          <div class="text-neutral-500">Annotations: ${task.annotations.length}</div>
        </div>
      `);

      markersLayerRef.current?.addLayer(marker);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mapRef/markersLayerRef are stable refs returned from useLeafletMap
  }, [tasks, mapReady]);

  const taskCounts = tasks.reduce(
    (acc, task) => {
      const status = task.task_status ?? 'pending';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div>
      <h2 className="text-lg font-semibold text-neutral-900 mb-4">
        Task Locations ({tasks.length} total)
      </h2>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-4 text-sm">
        {Object.entries(TASK_STATUS_CONFIG).map(([status, config]) => {
          const count = taskCounts[status] || 0;
          if (count === 0 && status !== 'pending') return null;
          return (
            <div key={status} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: config.color }} />
              <span className="text-neutral-700">
                {config.label} ({count})
              </span>
            </div>
          );
        })}
      </div>

      {/* Map Container */}
      <div ref={containerRef} className="w-full h-80 rounded-lg border border-neutral-200" />

      <style>{`
        .task-marker {
          background: transparent !important;
          border: none !important;
        }
      `}</style>
    </div>
  );
});

TaskLocationsMap.displayName = 'TaskLocationsMap';
