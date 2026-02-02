import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AnnotationTaskOut, LabelBase } from '~/api/client';
import { getTaskStatus, formatTaskStatus } from '~/utils/taskStatus';

interface AnnotationDistributionMapProps {
  tasks: AnnotationTaskOut[];
  labels: LabelBase[];
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

// Generate distinct colors for labels
const generateLabelColors = (labels: LabelBase[]): Record<number, string> => {
  const colors: Record<number, string> = {};
  const hueStep = 360 / Math.max(labels.length, 1);

  labels.forEach((label, index) => {
    const hue = (index * hueStep) % 360;
    // Use varying saturation and lightness for better distinction
    const saturation = 70 + (index % 3) * 10;
    const lightness = 45 + (index % 2) * 10;
    colors[label.id] = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  });

  return colors;
};

// Gray color for pending tasks
const PENDING_COLOR = '#9CA3AF';
const SKIPPED_COLOR = '#F59E0B';

export const AnnotationDistributionMap: React.FC<AnnotationDistributionMapProps> = ({
  tasks,
  labels,
  bbox,
}) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [labelColors, setLabelColors] = useState<Record<number, string>>({});

  // Generate label colors
  useEffect(() => {
    setLabelColors(generateLabelColors(labels));
  }, [labels]);

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

  // Update markers when tasks or label colors change
  useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current || !mapReady) return;

    // Clear existing markers
    markersLayerRef.current.clearLayers();

    // Add markers for each task
    tasks.forEach((task) => {
      const coords = parseWKTPoint(task.geometry.geometry);
      if (!coords) return;

      const taskStatus = getTaskStatus(task);
      const annotations = task.annotations || [];
      
      let markerColor = PENDING_COLOR;
      let labelName = 'Pending';

      if (taskStatus === 'complete' || taskStatus === 'partial' || taskStatus === 'conflicting') {
        // Use the most common label for color (or first annotation if no consensus)
        if (annotations.length > 0) {
          const firstAnnotation = annotations[0];
          if (firstAnnotation.label_id) {
            markerColor = labelColors[firstAnnotation.label_id] || PENDING_COLOR;
            const label = labels.find((l) => l.id === firstAnnotation.label_id);
            labelName = label ? label.name : `Label #${firstAnnotation.label_id}`;
          } else {
            markerColor = SKIPPED_COLOR;
            labelName = 'Skipped';
          }
        }
        
        // Special colors for conflicting
        if (taskStatus === 'conflicting') {
          markerColor = '#ef4444'; // red
          labelName = 'Conflicting';
        }
      }

      const icon = L.divIcon({
        html: `
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="10" cy="10" r="7" fill="${markerColor}" stroke="white" stroke-width="2.5"/>
          </svg>
        `,
        className: 'annotation-marker',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      const marker = L.marker(coords, { icon });

      // Add popup with task info
      const assignments = task.assignments || [];
      const assignedTo = assignments.length > 0
        ? assignments.map(a => a.user_id).join(', ')
        : 'Unassigned';

      const annotationInfo = annotations.length > 0
        ? annotations.map(a => {
            const label = labels.find(l => l.id === a.label_id);
            return `${label?.name || 'Skipped'} (by ${a.created_by_user_id})`;
          }).join('<br>')
        : 'No annotations';

      marker.bindPopup(`
        <div class="text-sm">
          <div class="font-medium mb-1">Task #${task.annotation_number}</div>
          <div class="text-xs text-neutral-600">Status: <span class="capitalize">${formatTaskStatus(taskStatus)}</span></div>
          <div class="text-xs text-neutral-600">Annotations: ${annotationInfo}</div>
          <div class="text-xs text-neutral-600">Assigned: ${assignedTo}</div>
          ${annotations.length > 0 && annotations[0].comment ? `<div class="text-xs text-neutral-600 mt-1">💬 ${annotations[0].comment}</div>` : ''}
        </div>
      `);

      markersLayerRef.current?.addLayer(marker);
    });
  }, [tasks, mapReady, labelColors, labels]);

  // Calculate statistics by label
  const labelStats = labels
    .map((label) => {
      const count = tasks.filter((t) => {
        const annotations = t.annotations || [];
        return annotations.some(a => a.label_id === label.id);
      }).length;
      return { label, count, color: labelColors[label.id] };
    })
    .filter((stat) => stat.count > 0);

  const pendingCount = tasks.filter((t) => getTaskStatus(t) === 'pending').length;
  const completeCount = tasks.filter((t) => getTaskStatus(t) === 'complete').length;
  const partialCount = tasks.filter((t) => getTaskStatus(t) === 'partial').length;
  const conflictingCount = tasks.filter((t) => getTaskStatus(t) === 'conflicting').length;

  return (
    <div className="bg-white rounded-lg border border-neutral-300 p-6">
      <h2 className="text-lg font-semibold text-neutral-900 mb-4">
        Annotation Distribution ({tasks.length} total)
      </h2>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-4 text-sm">
        {labelStats.map(({ label, count, color }) => (
          <div key={label.id} className="flex items-center gap-2">
            <span
              className="w-4 h-4 rounded-full border-2 border-white"
              style={{ backgroundColor: color, boxShadow: '0 0 0 1px rgba(0,0,0,0.1)' }}
            />
            <span className="text-neutral-700">
              {label.name} ({count})
            </span>
          </div>
        ))}
        {pendingCount > 0 && (
          <div className="flex items-center gap-2">
            <span
              className="w-4 h-4 rounded-full border-2 border-white"
              style={{ backgroundColor: PENDING_COLOR, boxShadow: '0 0 0 1px rgba(0,0,0,0.1)' }}
            />
            <span className="text-neutral-700">Pending ({pendingCount})</span>
          </div>
        )}
        {partialCount > 0 && (
          <div className="flex items-center gap-2">
            <span
              className="w-4 h-4 rounded-full border-2 border-white"
              style={{ backgroundColor: '#fbbf24', boxShadow: '0 0 0 1px rgba(0,0,0,0.1)' }}
            />
            <span className="text-neutral-700">Partial ({partialCount})</span>
          </div>
        )}
        {conflictingCount > 0 && (
          <div className="flex items-center gap-2">
            <span
              className="w-4 h-4 rounded-full border-2 border-white"
              style={{ backgroundColor: '#ef4444', boxShadow: '0 0 0 1px rgba(0,0,0,0.1)' }}
            />
            <span className="text-neutral-700">Conflicting ({conflictingCount})</span>
          </div>
        )}
        {completeCount > 0 && (
          <div className="flex items-center gap-2">
            <span
              className="w-4 h-4 rounded-full border-2 border-white"
              style={{ backgroundColor: '#10b981', boxShadow: '0 0 0 1px rgba(0,0,0,0.1)' }}
            />
            <span className="text-neutral-700">Complete ({completeCount})</span>
          </div>
        )}
      </div>

      {/* Map Container */}
      <div ref={containerRef} className="w-full h-96 rounded-lg border border-neutral-200" />

      <style>{`
        .annotation-marker {
          background: transparent !important;
          border: none !important;
        }
      `}</style>
    </div>
  );
};
