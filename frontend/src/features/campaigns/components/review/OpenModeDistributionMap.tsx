import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AnnotationOut, LabelBase } from '~/api/client';
import { extractCentroidFromWKT } from '~/shared/utils/utility';
import { generateLabelColors } from './labelColors';

interface OpenModeDistributionMapProps {
  annotations: AnnotationOut[];
  labels: LabelBase[];
  bbox: { west: number; south: number; east: number; north: number };
  highlightedAnnotationId: number | null;
  onAnnotationClick: (annotation: AnnotationOut) => void;
}

const NO_LABEL_COLOR = '#9CA3AF';

export const OpenModeDistributionMap: React.FC<OpenModeDistributionMapProps> = ({
  annotations,
  labels,
  bbox,
  highlightedAnnotationId,
  onAnnotationClick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const markersMapRef = useRef<Map<number, L.Marker>>(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [labelColors, setLabelColors] = useState<Record<number, string>>({});

  useEffect(() => {
    setLabelColors(generateLabelColors(labels));
  }, [labels]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [(bbox.south + bbox.north) / 2, (bbox.west + bbox.east) / 2],
      zoom: 10,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OSM</a>, <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: ['a', 'b', 'c', 'd'],
      maxZoom: 19,
    }).addTo(map);

    const bounds = L.latLngBounds([bbox.south, bbox.west], [bbox.north, bbox.east]);
    map.fitBounds(bounds, { padding: [20, 20] });

    L.rectangle(bounds, {
      color: '#326247',
      weight: 2,
      fillOpacity: 0.05,
      dashArray: '5, 5',
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setMapReady(true);

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      setMapReady(false);
    };
  }, [bbox.west, bbox.south, bbox.east, bbox.north]);

  useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current || !mapReady) return;

    markersLayerRef.current.clearLayers();
    markersMapRef.current.clear();

    annotations.forEach((ann) => {
      const centroid = extractCentroidFromWKT(ann.geometry.geometry);
      if (!centroid) return;

      const coords: [number, number] = [centroid.lat, centroid.lon];

      let markerColor = NO_LABEL_COLOR;
      let labelName = 'No label';

      if (ann.label_id !== null) {
        markerColor = labelColors[ann.label_id] || NO_LABEL_COLOR;
        const label = labels.find((l) => l.id === ann.label_id);
        labelName = label?.name || `Label #${ann.label_id}`;
      }

      const isHighlighted = ann.id === highlightedAnnotationId;
      const size = isHighlighted ? 26 : 20;
      const radius = isHighlighted ? 9 : 7;
      const strokeWidth = isHighlighted ? 3.5 : 2.5;

      const icon = L.divIcon({
        html: `
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="${markerColor}" stroke="${isHighlighted ? '#fbbf24' : 'white'}" stroke-width="${strokeWidth}"/>
          </svg>
        `,
        className: 'annotation-marker',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker(coords, {
        icon,
        zIndexOffset: isHighlighted ? 1000 : 0,
      });

      const confidence = ann.confidence != null ? `${ann.confidence}/5` : 'N/A';

      marker.bindPopup(`
        <div class="text-sm">
          <div class="font-medium mb-1">Annotation #${ann.id}</div>
          <div class="text-xs text-neutral-600">Label: <span class="capitalize">${labelName}</span></div>
          <div class="text-xs text-neutral-600">Confidence: ${confidence}</div>
          ${ann.comment?.trim() ? `<div class="text-xs text-neutral-600 mt-1">💬 ${ann.comment}</div>` : ''}
          <div class="text-xs text-brand-600 mt-2 cursor-pointer font-medium">Click to navigate →</div>
        </div>
      `);

      marker.on('click', () => {
        onAnnotationClick(ann);
      });

      markersLayerRef.current?.addLayer(marker);
      markersMapRef.current.set(ann.id, marker);
    });
  }, [annotations, mapReady, labelColors, labels, highlightedAnnotationId, onAnnotationClick]);

  useEffect(() => {
    if (!mapRef.current || !mapReady || highlightedAnnotationId === null) return;
    const marker = markersMapRef.current.get(highlightedAnnotationId);
    if (marker) {
      const ll = marker.getLatLng();
      mapRef.current.panTo(ll, { animate: true, duration: 0.3 });
    }
  }, [highlightedAnnotationId, mapReady]);

  const labelStats = labels
    .map((label) => {
      const count = annotations.filter((a) => a.label_id === label.id).length;
      return { label, count, color: labelColors[label.id] };
    })
    .filter((stat) => stat.count > 0);

  const noLabelCount = annotations.filter((a) => a.label_id === null).length;

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-3 text-sm">
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
        {noLabelCount > 0 && (
          <div className="flex items-center gap-2">
            <span
              className="w-4 h-4 rounded-full border-2 border-white"
              style={{ backgroundColor: NO_LABEL_COLOR, boxShadow: '0 0 0 1px rgba(0,0,0,0.1)' }}
            />
            <span className="text-neutral-700">No label ({noLabelCount})</span>
          </div>
        )}
      </div>

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
