import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AnnotationTaskOut } from '~/api/client';
import { getTaskStatus, formatTaskStatus, getTaskStatusColor } from '~/utils/taskStatus';

interface TaskLocationsMapProps {
  tasks: AnnotationTaskOut[];
  bbox: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
}

// Helper to parse WKT point geometry
const parseWKTPoint = (wkt: string): [number, number] | null => {
  // Handle "POINT (lon lat)" format
  const match = wkt.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (match) {
    const lon = parseFloat(match[1]);
    const lat = parseFloat(match[2]);
    return [lat, lon]; // Leaflet uses [lat, lon]
  }
  return null;
};

// Status colors for task markers
const STATUS_COLORS: Record<string, string> = {
  pending: '#6B7280', // gray
  assigned: '#3B82F6', // blue
  completed: '#10B981', // green
  skipped: '#F59E0B', // amber
};

export const TaskLocationsMap: React.FC<TaskLocationsMapProps> = ({ tasks, bbox }) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [(bbox.south + bbox.north) / 2, (bbox.west + bbox.east) / 2],
      zoom: 10,
      zoomControl: true,
      attributionControl: true,
    });

    // Add CartoDB basemap
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OSM</a>, <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: ['a', 'b', 'c', 'd'],
      maxZoom: 19,
    }).addTo(map);

    // Fit to bbox
    const bounds = L.latLngBounds([bbox.south, bbox.west], [bbox.north, bbox.east]);
    map.fitBounds(bounds, { padding: [20, 20] });

    // Add bbox rectangle
    L.rectangle(bounds, {
      color: '#326247',
      weight: 2,
      fillOpacity: 0.05,
      dashArray: '5, 5',
    }).addTo(map);

    // Create markers layer group
    markersLayerRef.current = L.layerGroup().addTo(map);

    mapRef.current = map;
    setMapReady(true);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        setMapReady(false);
      }
    };
  }, [bbox.west, bbox.south, bbox.east, bbox.north]);

  // Update markers when tasks change
  useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current || !mapReady) return;

    // Clear existing markers
    markersLayerRef.current.clearLayers();

    // Add markers for each task
    tasks.forEach((task) => {
      const coords = parseWKTPoint(task.geometry.geometry);
      if (!coords) return;

      const taskStatus = getTaskStatus(task);
      const statusColorMap: Record<string, string> = {
        pending: '#6B7280',
        partial: '#fbbf24',
        conflicting: '#ef4444',
        complete: '#10b981',
      };
      const statusColor = statusColorMap[taskStatus] || '#6B7280';

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
      const assignedTo = assignments.length > 0
        ? assignments.map(a => a.user_id).join(', ')
        : 'Unassigned';

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
  }, [tasks, mapReady]);

  const taskCounts = tasks.reduce(
    (acc, task) => {
      const status = getTaskStatus(task);
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="bg-white rounded-lg border border-neutral-300 p-6">
      <h2 className="text-lg font-semibold text-neutral-900 mb-4">
        Task Locations ({tasks.length} total)
      </h2>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-4 text-sm">
        {Object.entries(STATUS_COLORS).map(([status, color]) => {
          const count = taskCounts[status] || 0;
          if (count === 0 && status !== 'pending') return null;
          return (
            <div key={status} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-neutral-700 capitalize">
                {status} ({count})
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
};
