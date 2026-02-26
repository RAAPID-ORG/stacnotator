import { useEffect } from 'react';
import { MapContainer, TileLayer, Rectangle, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface MiniMapProps {
  center: [number, number]; // [lat, lon]
  bbox: [number, number, number, number]; // [west, south, east, north]
  visibleBounds?: [number, number, number, number] | null; // Current visible bounds of main map [west, south, east, north]
}

// Custom icon for the center marker
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

// Helper to handle map bounds adjustments
const MapController = ({
  bbox,
  visibleBounds,
}: {
  bbox: [number, number, number, number];
  visibleBounds?: [number, number, number, number] | null;
}) => {
  const map = useMap();

  // Invalidate size on mount and when container might resize
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 100);
    return () => clearTimeout(timer);
  }, [map]);

  useEffect(() => {
    const [west, south, east, north] = bbox;

    if (visibleBounds) {
      const [vWest, vSouth, vEast, vNorth] = visibleBounds;

      // Calculate combined bounds that include both the campaign bbox and visible bounds
      const combinedWest = Math.min(west, vWest);
      const combinedSouth = Math.min(south, vSouth);
      const combinedEast = Math.max(east, vEast);
      const combinedNorth = Math.max(north, vNorth);

      // Add padding to ensure visibility (10% on each side)
      const latPadding = (combinedNorth - combinedSouth) * 0.1;
      const lonPadding = (combinedEast - combinedWest) * 0.1;

      const paddedBounds = L.latLngBounds(
        [combinedSouth - latPadding, combinedWest - lonPadding],
        [combinedNorth + latPadding, combinedEast + lonPadding]
      );

      map.fitBounds(paddedBounds, {
        animate: true,
        duration: 0.3,
        padding: [10, 10],
      });
    } else {
      // Just fit to campaign bbox
      const bounds = L.latLngBounds([south, west], [north, east]);
      map.fitBounds(bounds);
    }

    // Invalidate size after bounds change to ensure tiles load
    map.invalidateSize();
  }, [map, bbox, visibleBounds]);

  return null;
};

const MiniMap: React.FC<MiniMapProps> = ({ center, bbox, visibleBounds }) => {
  const [west, south, east, north] = bbox;
  const bboxCenter: [number, number] = [(south + north) / 2, (west + east) / 2];

  // Create stable keys for rectangles to force re-render when bounds change
  const campaignBboxKey = `campaign-${west}-${south}-${east}-${north}`;
  const visibleBoundsKey = visibleBounds
    ? `visible-${visibleBounds[0]}-${visibleBounds[1]}-${visibleBounds[2]}-${visibleBounds[3]}`
    : null;

  return (
    <>
      <MapContainer
        center={bboxCenter}
        zoom={8}
        zoomControl={false}
        attributionControl={false}
        keyboard={false}
        zoomAnimation={true}
        fadeAnimation={true}
        markerZoomAnimation={true}
        scrollWheelZoom={true}
        className="w-full h-full"
        style={{ width: '100%', height: '100%' }}
      >
        {/* Add custom attribution control */}
        <div className="leaflet-bottom leaflet-right">
          <div className="leaflet-control-attribution leaflet-control">
            &copy; <a href="http://www.openstreetmap.org/copyright">OSM</a>,{' '}
            <a href="https://carto.com/attributions">CARTO</a>
          </div>
        </div>

        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
          attribution='&copy; <a href="http://www.openstreetmap.org/copyright">OSM</a>, <a href="https://carto.com/attributions">CARTO</a>'
          subdomains={['a', 'b', 'c', 'd']}
          maxZoom={19}
        />

        {/* Campaign bounding box outline */}
        <Rectangle
          key={campaignBboxKey}
          bounds={[
            [south, west],
            [north, east],
          ]}
          pathOptions={{
            color: 'rgb(150, 150, 150)',
            weight: 1.5,
            fillOpacity: 0,
            dashArray: '5, 5',
          }}
        />

        {/* Visible bounds rectangle (only in open mode) */}
        {visibleBounds && visibleBoundsKey && (
          <Rectangle
            key={visibleBoundsKey}
            bounds={[
              [visibleBounds[1], visibleBounds[0]],
              [visibleBounds[3], visibleBounds[2]],
            ]}
            pathOptions={{
              color: 'rgb(50, 98, 71)',
              weight: 2,
              fillColor: 'rgb(50, 98, 71)',
              fillOpacity: 0.15,
            }}
          />
        )}

        {/* Center marker (only in task mode when no visible bounds) */}
        {!visibleBounds && <Marker position={center} icon={circleIcon} />}

        {/* Controller for adjusting map bounds */}
        <MapController bbox={bbox} visibleBounds={visibleBounds} />
      </MapContainer>

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
