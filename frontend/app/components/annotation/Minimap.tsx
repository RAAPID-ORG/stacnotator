import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface MiniMapProps {
  center: [number, number]; // [lat, lon]
  bbox: [number, number, number, number]; // [west, south, east, north]
  visibleBounds?: [number, number, number, number] | null; // Current visible bounds of main map [west, south, east, north]
}

const MiniMap: React.FC<MiniMapProps> = ({ center, bbox, visibleBounds }) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const boundsRectRef = useRef<L.Rectangle | null>(null);
  const campaignBboxRectRef = useRef<L.Rectangle | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Extract bbox values for stable dependency comparison
  const [west, south, east, north] = bbox;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const bboxCenter: [number, number] = [(south + north) / 2, (west + east) / 2];

    const map = L.map(containerRef.current, {
      center: bboxCenter,
      zoom: 8,
      zoomControl: false,
      attributionControl: false,
      keyboard: false, // Disable keyboard handlers for minimap
      // Performance optimizations for smoother panning and zooming
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
      wheelPxPerZoomLevel: 60, // Smoother mousewheel zoom
    });

    L.control
      .attribution({
        position: 'bottomright',
        prefix: '',
      })
      .addTo(map);

    // CartoDB basemap
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OSM</a>, <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: ['a', 'b', 'c', 'd'],
      maxZoom: 19,
    }).addTo(map);

    const bounds = L.latLngBounds([south, west], [north, east]);
    map.fitBounds(bounds);

    // Add campaign bounding box outline
    campaignBboxRectRef.current = L.rectangle(
      [
        [south, west],
        [north, east],
      ],
      {
        color: 'rgb(150, 150, 150)',
        weight: 1.5,
        fillOpacity: 0,
        dashArray: '5, 5',
      }
    ).addTo(map);

    mapRef.current = map;
    setMapReady(true);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        setMapReady(false);
      }
    };
  }, [west, south, east, north]);

  // Update marker position - use primitive values for dependency comparison
  // Also depend on mapReady to ensure marker is added after map initialization
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;

    // Only show marker if no visible bounds (task mode)
    if (visibleBounds) {
      // Remove marker in open mode when showing bounds
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }

    if (markerRef.current) {
      markerRef.current.remove();
    }

    const circleIcon = L.divIcon({
      html: `
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="6" cy="6" r="5" fill="rgb(50, 98, 71)" stroke="white" stroke-width="1.5"/>
        </svg>
      `,
      className: 'custom-pin-marker',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });

    markerRef.current = L.marker(center, { icon: circleIcon }).addTo(mapRef.current);

    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  }, [center[0], center[1], mapReady, visibleBounds]);

  // Update visible bounds rectangle and adjust minimap viewport
  useEffect(() => {
    if (!mapRef.current || !mapReady || !visibleBounds) return;

    const [west, south, east, north] = visibleBounds;
    const [bboxWest, bboxSouth, bboxEast, bboxNorth] = bbox;

    if (boundsRectRef.current) {
      boundsRectRef.current.remove();
    }

    // Create a semi-transparent rectangle to show the visible area
    boundsRectRef.current = L.rectangle(
      [
        [south, west],
        [north, east],
      ],
      {
        color: 'rgb(50, 98, 71)',
        weight: 2,
        fillColor: 'rgb(50, 98, 71)',
        fillOpacity: 0.15,
      }
    ).addTo(mapRef.current);

    // Bring campaign bbox to front so it's always visible above the visible bounds
    if (campaignBboxRectRef.current) {
      campaignBboxRectRef.current.bringToFront();
    }

    // Adjust minimap viewport to show both the campaign bbox and the visible bounds
    // Calculate combined bounds that include both areas
    const combinedWest = Math.min(west, bboxWest);
    const combinedSouth = Math.min(south, bboxSouth);
    const combinedEast = Math.max(east, bboxEast);
    const combinedNorth = Math.max(north, bboxNorth);

    // Add padding to ensure visibility (10% on each side)
    const latPadding = (combinedNorth - combinedSouth) * 0.1;
    const lonPadding = (combinedEast - combinedWest) * 0.1;

    const paddedBounds = L.latLngBounds(
      [combinedSouth - latPadding, combinedWest - lonPadding],
      [combinedNorth + latPadding, combinedEast + lonPadding]
    );

    // Fit the minimap to show both the campaign bbox and the visible bounds
    mapRef.current.fitBounds(paddedBounds, {
      animate: true,
      duration: 0.3,
      padding: [10, 10],
    });

    return () => {
      if (boundsRectRef.current) {
        boundsRectRef.current.remove();
        boundsRectRef.current = null;
      }
    };
  }, [
    visibleBounds?.[0],
    visibleBounds?.[1],
    visibleBounds?.[2],
    visibleBounds?.[3],
    bbox,
    mapReady,
  ]);

  return (
    <>
      <div ref={containerRef} className="w-full h-full" />
      <style>{`
        .custom-pin-marker {
          background: transparent !important;
          border: none !important;
        }
        
        /* Make attribution text smaller in minimap */
        .leaflet-control-attribution {
          font-size: 8px !important;
          padding: 1px 3px !important;
          background: rgba(255, 255, 255, 0.8) !important;
        }
      `}</style>
    </>
  );
};

export default MiniMap;
