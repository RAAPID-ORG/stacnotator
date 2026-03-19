import { useEffect, useRef, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Rectangle, Marker, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface AnnotationDot {
  lat: number;
  lon: number;
}

interface MiniMapProps {
  center: [number, number]; // [lat, lon]
  bbox: [number, number, number, number]; // [west, south, east, north]
  visibleBounds?: [number, number, number, number] | null; // Current visible bounds of main map [west, south, east, north]
  /** Called when the user drags the viewport rectangle or clicks on the minimap. */
  onViewportDrag?: (lat: number, lon: number) => void;
  /** When true (task mode), fit the campaign bbox on the minimap instead of the viewport. */
  fitBbox?: boolean;
  /** Annotation locations to show as dots (open mode only). */
  annotationDots?: AnnotationDot[];
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
  fitBbox,
}: {
  bbox: [number, number, number, number];
  visibleBounds?: [number, number, number, number] | null;
  fitBbox?: boolean;
}) => {
  const map = useMap();
  const hasFittedBbox = useRef(false);

  // Invalidate size on mount and when container might resize
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 100);
    return () => clearTimeout(timer);
  }, [map]);

  // Task mode: fit the campaign bounding box on the minimap
  useEffect(() => {
    if (!fitBbox || hasFittedBbox.current) return;
    hasFittedBbox.current = true;
    const [west, south, east, north] = bbox;
    map.fitBounds(
      L.latLngBounds([south, west], [north, east]),
      { animate: false, padding: [10, 10] }
    );
  }, [map, bbox, fitBbox]);

  // Open mode: continuously adjust minimap so the main viewport is always visible
  // with surrounding context.
  useEffect(() => {
    if (fitBbox) return; // skip in task mode
    if (!visibleBounds) return;

    const [vWest, vSouth, vEast, vNorth] = visibleBounds;
    const viewportBounds = L.latLngBounds([vSouth, vWest], [vNorth, vEast]);

    // Check if the viewport is already fully visible in the current minimap view
    const currentBounds = map.getBounds();
    if (currentBounds.contains(viewportBounds)) {
      // Viewport is visible — but check it's not too tiny (zoom out too far).
      // If viewport area is less than ~5% of minimap area, we should re-fit.
      const vArea = (vNorth - vSouth) * (vEast - vWest);
      const mArea = (currentBounds.getNorth() - currentBounds.getSouth()) *
                    (currentBounds.getEast() - currentBounds.getWest());
      if (mArea > 0 && vArea / mArea > 0.02) return; // viewport is visible and reasonably sized
    }

    // Fit with padding around the viewport
    const latSpan = vNorth - vSouth;
    const lonSpan = vEast - vWest;
    const padded = L.latLngBounds(
      [vSouth - latSpan * 1.5, vWest - lonSpan * 1.5],
      [vNorth + latSpan * 1.5, vEast + lonSpan * 1.5]
    );
    map.fitBounds(padded, { animate: true, duration: 0.3, padding: [10, 10] });
  }, [map, fitBbox, visibleBounds]);

  // If bbox changes (different campaign), allow re-fit
  const prevBboxRef = useRef(bbox);
  useEffect(() => {
    if (prevBboxRef.current === bbox) return;
    prevBboxRef.current = bbox;
    hasFittedBbox.current = false;
  }, [bbox]);

  return null;
};

/**
 * Draggable viewport rectangle for the minimap.
 * Allows clicking/dragging on the minimap to move the main map's viewport.
 */
const DraggableViewport = ({
  visibleBounds,
  onViewportDrag,
}: {
  visibleBounds: [number, number, number, number];
  onViewportDrag: (lat: number, lon: number) => void;
}) => {
  const isDragging = useRef(false);
  const rafId = useRef<number | null>(null);
  const onViewportDragRef = useRef(onViewportDrag);
  onViewportDragRef.current = onViewportDrag;
  const boundsRef = useRef(visibleBounds);
  boundsRef.current = visibleBounds;

  const [west, south, east, north] = visibleBounds;

  const scheduleUpdate = useCallback((latlng: L.LatLng) => {
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      onViewportDragRef.current(latlng.lat, latlng.lng);
    });
  }, []);

  // Intercept drag events on the minimap itself
  useMapEvents({
    mousedown(e) {
      const [bW, bS, bE, bN] = boundsRef.current;
      const clickBounds = L.latLngBounds([bS, bW], [bN, bE]);
      if (clickBounds.contains(e.latlng)) {
        isDragging.current = true;
        e.originalEvent.preventDefault();
        const container = e.target.getContainer();
        if (container) container.style.cursor = 'grabbing';
        e.target.dragging.disable();
        e.target.scrollWheelZoom.disable();
      }
    },
    mousemove(e) {
      if (!isDragging.current) return;
      scheduleUpdate(e.latlng);
    },
    mouseup(e) {
      if (isDragging.current) {
        isDragging.current = false;
        // Cancel any pending RAF and fire final update immediately
        if (rafId.current !== null) {
          cancelAnimationFrame(rafId.current);
          rafId.current = null;
        }
        onViewportDragRef.current(e.latlng.lat, e.latlng.lng);
        const container = e.target.getContainer();
        if (container) container.style.cursor = '';
        e.target.dragging.enable();
        e.target.scrollWheelZoom.enable();
      }
    },
  });

  return (
    <Rectangle
      bounds={[
        [south, west],
        [north, east],
      ]}
      pathOptions={{
        color: 'rgb(50, 98, 71)',
        weight: 2,
        fillColor: 'rgb(50, 98, 71)',
        fillOpacity: 0.15,
      }}
      eventHandlers={{
        add(e) {
          // Set grab cursor on the SVG path element once it's added to the map
          const el = e.target.getElement();
          if (el) {
            el.style.cursor = 'grab';
          }
        },
      }}
    />
  );
};

/**
 * Click-to-pan handler for the minimap - clicking outside the viewport
 * rectangle moves the main map to the clicked location.
 */
const ClickToPan = ({
  onViewportDrag,
  visibleBounds,
}: {
  onViewportDrag: (lat: number, lon: number) => void;
  visibleBounds?: [number, number, number, number] | null;
}) => {
  const onViewportDragRef = useRef(onViewportDrag);
  onViewportDragRef.current = onViewportDrag;
  const boundsRef = useRef(visibleBounds);
  boundsRef.current = visibleBounds;

  useMapEvents({
    click(e) {
      // If visible bounds exist, only fire if clicking OUTSIDE the viewport rect
      const vb = boundsRef.current;
      if (vb) {
        const [west, south, east, north] = vb;
        const clickBounds = L.latLngBounds([south, west], [north, east]);
        if (clickBounds.contains(e.latlng)) return;
      }
      onViewportDragRef.current(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
};

const MiniMap: React.FC<MiniMapProps> = ({ center, bbox, visibleBounds, onViewportDrag, fitBbox, annotationDots }) => {
  const [west, south, east, north] = bbox;
  // Prefer viewport center over campaign bbox center
  const mapCenter: [number, number] = visibleBounds
    ? [(visibleBounds[1] + visibleBounds[3]) / 2, (visibleBounds[0] + visibleBounds[2]) / 2]
    : center[0] !== 0 || center[1] !== 0
      ? center
      : [(south + north) / 2, (west + east) / 2];

  return (
    <>
      <MapContainer
        center={mapCenter}
        zoom={8}
        zoomControl={false}
        attributionControl={false}
        keyboard={false}
        zoomAnimation={true}
        fadeAnimation={true}
        markerZoomAnimation={true}
        scrollWheelZoom={true}
        doubleClickZoom={true}
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

        {/* Campaign bounding box outline (visual reference only) */}
        <Rectangle
          bounds={[
            [south, west],
            [north, east],
          ]}
          pathOptions={{
            color: 'rgb(150, 150, 150)',
            weight: 1,
            fillOpacity: 0,
            dashArray: '4, 4',
          }}
        />

        {/* Draggable visible bounds rectangle (when drag callback is provided) */}
        {visibleBounds && onViewportDrag && (
          <DraggableViewport
            visibleBounds={visibleBounds}
            onViewportDrag={onViewportDrag}
          />
        )}

        {/* Static visible bounds rectangle (when no drag callback) */}
        {visibleBounds && !onViewportDrag && (
          <Rectangle
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

        {/* Click-to-pan: clicking anywhere on minimap pans the main map */}
        {onViewportDrag && (
          <ClickToPan onViewportDrag={onViewportDrag} visibleBounds={visibleBounds} />
        )}

        {/* Annotation dots (open mode) */}
        {annotationDots?.map((dot, i) => (
          <CircleMarker
            key={i}
            center={[dot.lat, dot.lon]}
            radius={3}
            pathOptions={{
              color: 'rgb(220, 80, 60)',
              fillColor: 'rgb(220, 80, 60)',
              fillOpacity: 0.7,
              weight: 1,
            }}
          />
        ))}

        {/* Center marker (only in task mode when no visible bounds) */}
        {!visibleBounds && <Marker position={center} icon={circleIcon} />}

        {/* Controller for adjusting map bounds */}
        <MapController bbox={bbox} visibleBounds={visibleBounds} fitBbox={fitBbox} />
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
