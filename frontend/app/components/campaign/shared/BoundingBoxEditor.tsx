import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface BoundingBoxEditorProps {
  value: {
    bbox_west: number;
    bbox_south: number;
    bbox_east: number;
    bbox_north: number;
  };
  onChange: (updates: {
    bbox_west?: number;
    bbox_south?: number;
    bbox_east?: number;
    bbox_north?: number;
  }) => void;
}

export const BoundingBoxEditor = ({ value, onChange }: BoundingBoxEditorProps) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rectangleRef = useRef<L.Rectangle | null>(null);
  const markersRef = useRef<{ nw: L.Marker | null; se: L.Marker | null }>({ nw: null, se: null });
  const isUpdatingFromDragRef = useRef(false);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [0, 0],
      zoom: 2,
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

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update rectangle when bbox changes
  useEffect(() => {
    if (!mapRef.current) return;

    // Don't update if we're in the middle of dragging
    if (isUpdatingFromDragRef.current) {
      isUpdatingFromDragRef.current = false;
      return;
    }

    const { bbox_west, bbox_south, bbox_east, bbox_north } = value;

    // Validate bbox
    if (
      isNaN(bbox_west) ||
      isNaN(bbox_south) ||
      isNaN(bbox_east) ||
      isNaN(bbox_north) ||
      bbox_west >= bbox_east ||
      bbox_south >= bbox_north
    ) {
      // Remove rectangle if invalid
      if (rectangleRef.current) {
        rectangleRef.current.remove();
        rectangleRef.current = null;
      }
      if (markersRef.current.nw) {
        markersRef.current.nw.remove();
        markersRef.current.nw = null;
      }
      if (markersRef.current.se) {
        markersRef.current.se.remove();
        markersRef.current.se = null;
      }
      return;
    }

    const bounds = L.latLngBounds([bbox_south, bbox_west], [bbox_north, bbox_east]);

    if (rectangleRef.current) {
      // Update existing rectangle and markers
      rectangleRef.current.setBounds(bounds);
      if (markersRef.current.nw) {
        markersRef.current.nw.setLatLng([bbox_north, bbox_west]);
      }
      if (markersRef.current.se) {
        markersRef.current.se.setLatLng([bbox_south, bbox_east]);
      }
    } else {
      // Create new rectangle
      const rectangle = L.rectangle(bounds, {
        color: '#326247',
        weight: 2,
        fillOpacity: 0.2,
        dashArray: '5, 5',
      }).addTo(mapRef.current);

      rectangleRef.current = rectangle;

      // Make rectangle draggable to move entire bbox
      let isDragging = false;
      let dragStart: { lat: number; lng: number; bounds: L.LatLngBounds } | null = null;

      rectangle.on('mousedown', (e: L.LeafletMouseEvent) => {
        const originalEvent = e.originalEvent as MouseEvent;
        // Only start drag if not clicking on a corner marker
        if (!(originalEvent.target as HTMLElement).closest('.bbox-corner-marker')) {
          isDragging = true;
          dragStart = {
            lat: e.latlng.lat,
            lng: e.latlng.lng,
            bounds: rectangle.getBounds(),
          };
          mapRef.current!.dragging.disable();
          L.DomEvent.stopPropagation(e);
        }
      });

      const handleMouseMove = (e: L.LeafletMouseEvent) => {
        if (!isDragging || !dragStart) return;

        const deltaLat = e.latlng.lat - dragStart.lat;
        const deltaLng = e.latlng.lng - dragStart.lng;

        const newBounds = L.latLngBounds(
          [dragStart.bounds.getSouth() + deltaLat, dragStart.bounds.getWest() + deltaLng],
          [dragStart.bounds.getNorth() + deltaLat, dragStart.bounds.getEast() + deltaLng]
        );

        rectangle.setBounds(newBounds);
        if (markersRef.current.nw) {
          markersRef.current.nw.setLatLng([newBounds.getNorth(), newBounds.getWest()]);
        }
        if (markersRef.current.se) {
          markersRef.current.se.setLatLng([newBounds.getSouth(), newBounds.getEast()]);
        }
      };

      const handleMouseUp = () => {
        if (isDragging) {
          const newBounds = rectangle.getBounds();
          isUpdatingFromDragRef.current = true;
          onChange({
            bbox_west: newBounds.getWest(),
            bbox_south: newBounds.getSouth(),
            bbox_east: newBounds.getEast(),
            bbox_north: newBounds.getNorth(),
          });
          isDragging = false;
          dragStart = null;
          mapRef.current!.dragging.enable();
        }
      };

      mapRef.current.on('mousemove', handleMouseMove);
      mapRef.current.on('mouseup', handleMouseUp);
      document.addEventListener('mouseup', handleMouseUp);

      // Create corner markers - only NW (top-left) and SE (bottom-right)
      const createMarker = (lat: number, lng: number, isNW: boolean) => {
        const marker = L.marker([lat, lng], {
          draggable: true,
          icon: L.divIcon({
            html: `<div style="width: 14px; height: 14px; background: #326247; border: 2px solid white; border-radius: 50%; cursor: move; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></div>`,
            className: 'bbox-corner-marker',
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          }),
        }).addTo(mapRef.current!);

        marker.on('drag', () => {
          const pos = marker.getLatLng();
          const currentBounds = rectangle.getBounds();

          let newWest = currentBounds.getWest();
          let newEast = currentBounds.getEast();
          let newSouth = currentBounds.getSouth();
          let newNorth = currentBounds.getNorth();

          if (isNW) {
            // Northwest corner (top-left)
            newNorth = pos.lat;
            newWest = pos.lng;
          } else {
            // Southeast corner (bottom-right)
            newSouth = pos.lat;
            newEast = pos.lng;
          }

          // Ensure valid bounds
          if (newWest < newEast && newSouth < newNorth) {
            const newBounds = L.latLngBounds([newSouth, newWest], [newNorth, newEast]);
            rectangle.setBounds(newBounds);

            // Update the other marker
            if (isNW && markersRef.current.se) {
              markersRef.current.se.setLatLng([newSouth, newEast]);
            } else if (!isNW && markersRef.current.nw) {
              markersRef.current.nw.setLatLng([newNorth, newWest]);
            }
          }
        });

        marker.on('dragend', () => {
          const newBounds = rectangle.getBounds();
          isUpdatingFromDragRef.current = true;
          onChange({
            bbox_west: newBounds.getWest(),
            bbox_south: newBounds.getSouth(),
            bbox_east: newBounds.getEast(),
            bbox_north: newBounds.getNorth(),
          });
        });

        return marker;
      };

      markersRef.current.nw = createMarker(bbox_north, bbox_west, true);
      markersRef.current.se = createMarker(bbox_south, bbox_east, false);
    }

    // Fit map to bbox with padding
    mapRef.current.fitBounds(bounds, { padding: [50, 50] });
  }, [value, onChange]);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-neutral-700">Bounding Box</h3>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Text Inputs */}
        <div className="grid grid-cols-2 gap-4 lg:col-span-1">
          <label className="space-y-1">
            <span className="text-xs text-neutral-700">West (Long)</span>
            <input
              type="number"
              step="any"
              value={value.bbox_west}
              onChange={(e) => onChange({ bbox_west: Number(e.target.value) })}
              className="w-full border-b border-brand-500 focus:border-b-2 outline-none focus:ring-0"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-neutral-700">South (Lat)</span>
            <input
              type="number"
              step="any"
              value={value.bbox_south}
              onChange={(e) => onChange({ bbox_south: Number(e.target.value) })}
              className="w-full border-b border-brand-500 focus:border-b-2 outline-none focus:ring-0"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-neutral-700">East (Long)</span>
            <input
              type="number"
              step="any"
              value={value.bbox_east}
              onChange={(e) => onChange({ bbox_east: Number(e.target.value) })}
              className="w-full border-b border-brand-500 focus:border-b-2 outline-none focus:ring-0"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-neutral-700">North (Lat)</span>
            <input
              type="number"
              step="any"
              value={value.bbox_north}
              onChange={(e) => onChange({ bbox_north: Number(e.target.value) })}
              className="w-full border-b border-brand-500 focus:border-b-2 outline-none focus:ring-0"
            />
          </label>

          <div className="col-span-2 text-xs text-neutral-500 mt-2">
            Drag the corner handles to resize, or click and drag the box to move it
          </div>
        </div>

        {/* Map */}
        <div className="lg:col-span-2">
          <div ref={containerRef} className="w-full h-64 rounded-lg border border-neutral-200" />
        </div>
      </div>

      <style>{`
        .bbox-corner-marker {
          background: transparent !important;
          border: none !important;
        }
      `}</style>
    </div>
  );
};
