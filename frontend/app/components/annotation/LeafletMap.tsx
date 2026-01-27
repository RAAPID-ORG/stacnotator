import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-edgebuffer';

interface LeafletMapProps {
  center: [number, number]; // [lat, lon]
  zoom: number;
  tileUrl: string;
  crosshairColor: string;
  refocusTrigger?: number;
  showBasemap?: boolean;
  zoomInTrigger?: number;
  zoomOutTrigger?: number;
  panTrigger?: { direction: 'up' | 'down' | 'left' | 'right'; count: number };
  disableKeyboard?: boolean; // Disable keyboard handlers (for small imagery windows)
  onMapMove?: (
    center: [number, number],
    zoom: number,
    bounds: [number, number, number, number]
  ) => void; // Callback for map movement
  syncMapState?: boolean; // Whether this map should sync its state (only main map should)
  showCrosshair?: boolean; // Whether to show crosshair (default: true)
  enableTileBuffering?: boolean; // Enable tile preloading/buffering for smoother panning (default: false, only enable for main map)
}

const PAN_OFFSET = 100; // pixels to pan

const LeafletMap: React.FC<LeafletMapProps> = ({
  center,
  zoom,
  tileUrl,
  crosshairColor,
  refocusTrigger,
  showBasemap = false,
  zoomInTrigger,
  zoomOutTrigger,
  panTrigger,
  disableKeyboard = false,
  onMapMove,
  syncMapState = false,
  showCrosshair = true,
  enableTileBuffering = false,
}) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const basemapLayerRef = useRef<L.TileLayer | null>(null);
  const crosshairMarkerRef = useRef<L.Marker | null>(null);
  const scaleControlRef = useRef<L.Control.Scale | null>(null);

  // Track the last refocus trigger to detect actual refocus requests
  const lastRefocusTriggerRef = useRef<number | undefined>(refocusTrigger);
  // Track if map has been initialized with initial center
  const initializedRef = useRef(false);
  // Store the initial center/zoom for refocus
  const initialCenterRef = useRef<[number, number]>(center);
  const initialZoomRef = useRef<number>(zoom);

  // Track zoom/pan triggers
  const lastZoomInTriggerRef = useRef<number | undefined>(zoomInTrigger);
  const lastZoomOutTriggerRef = useRef<number | undefined>(zoomOutTrigger);
  const lastPanTriggerRef = useRef<number | undefined>(panTrigger?.count);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center,
      zoom,
      zoomControl: false,
      attributionControl: false,
      keyboard: !disableKeyboard, // Disable keyboard handlers for small imagery windows
      // Performance optimizations for smoother panning and zooming
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
      wheelPxPerZoomLevel: 60, // Smoother mousewheel zoom
    });

    scaleControlRef.current = L.control
      .scale({
        position: 'bottomleft',
        metric: true,
        imperial: false,
        maxWidth: 80,
      })
      .addTo(map);

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Listen to map move/zoom events and sync state (only for main map)
  useEffect(() => {
    if (!mapRef.current || !syncMapState || !onMapMove) return;

    const map = mapRef.current;

    const handleMoveEnd = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      const bounds = map.getBounds();

      onMapMove([center.lat, center.lng], zoom, [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ]);
    };

    // Listen to moveend which fires after pan, zoom, or any movement
    map.on('moveend', handleMoveEnd);
    map.on('zoomend', handleMoveEnd);

    return () => {
      map.off('moveend', handleMoveEnd);
      map.off('zoomend', handleMoveEnd);
    };
  }, [syncMapState, onMapMove]);

  // Only show attribution for basemap
  useEffect(() => {
    if (!mapRef.current) return;

    const map = mapRef.current;
    const existingAttribution = map.attributionControl;

    if (showBasemap && !existingAttribution) {
      L.control.attribution().addTo(map);
    } else if (!showBasemap && existingAttribution) {
      map.removeControl(existingAttribution);
    }
  }, [showBasemap]);

  // Set initial center and zoom only once, and update when center actually changes (new task)
  // For open mode with syncMapState, this will keep the map synced with store state
  useEffect(() => {
    if (!mapRef.current) return;

    // Check if center has actually changed (new task selected or external update)
    const centerChanged =
      initialCenterRef.current[0] !== center[0] || initialCenterRef.current[1] !== center[1];

    const zoomChanged = initialZoomRef.current !== zoom;

    if (!initializedRef.current || centerChanged || (syncMapState && zoomChanged)) {
      // Use setView without animation for smoother sync in open mode
      mapRef.current.setView(center, zoom, { animate: !syncMapState });
      initialCenterRef.current = center;
      initialZoomRef.current = zoom;
      initializedRef.current = true;
    }
  }, [center[0], center[1], zoom, syncMapState]);

  // Refocus when trigger changes (explicit user action)
  useEffect(() => {
    if (!mapRef.current || refocusTrigger === undefined) return;

    // Only refocus if trigger actually changed (not just on re-render)
    if (lastRefocusTriggerRef.current !== refocusTrigger) {
      lastRefocusTriggerRef.current = refocusTrigger;
      mapRef.current.setView(center, zoom);
    }
  }, [refocusTrigger, center[0], center[1], zoom]);

  // Zoom in when trigger changes
  useEffect(() => {
    if (!mapRef.current || zoomInTrigger === undefined) return;

    if (lastZoomInTriggerRef.current !== zoomInTrigger) {
      lastZoomInTriggerRef.current = zoomInTrigger;
      mapRef.current.zoomIn();
    }
  }, [zoomInTrigger]);

  // Zoom out when trigger changes
  useEffect(() => {
    if (!mapRef.current || zoomOutTrigger === undefined) return;

    if (lastZoomOutTriggerRef.current !== zoomOutTrigger) {
      lastZoomOutTriggerRef.current = zoomOutTrigger;
      mapRef.current.zoomOut();
    }
  }, [zoomOutTrigger]);

  // Pan when trigger changes
  useEffect(() => {
    if (!mapRef.current || !panTrigger) return;

    if (lastPanTriggerRef.current !== panTrigger.count) {
      lastPanTriggerRef.current = panTrigger.count;

      let x = 0,
        y = 0;
      switch (panTrigger.direction) {
        case 'up':
          y = -PAN_OFFSET;
          break;
        case 'down':
          y = PAN_OFFSET;
          break;
        case 'left':
          x = -PAN_OFFSET;
          break;
        case 'right':
          x = PAN_OFFSET;
          break;
      }

      mapRef.current.panBy([x, y]);
    }
  }, [panTrigger?.count, panTrigger?.direction]);

  // Update basemap layer
  useEffect(() => {
    if (!mapRef.current) return;

    if (basemapLayerRef.current) {
      basemapLayerRef.current.remove();
      basemapLayerRef.current = null;
    }

    if (showBasemap) {
      basemapLayerRef.current = L.tileLayer(
        'http://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        {
          attribution:
            '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: ['a', 'b', 'c', 'd', 'e'],
          maxZoom: 19,
          keepBuffer: enableTileBuffering ? 5 : 0,
          edgeBufferTiles: enableTileBuffering ? 2 : 0,
          updateWhenIdle: !enableTileBuffering,
        }
      ).addTo(mapRef.current);
    }

    return () => {
      if (basemapLayerRef.current) {
        basemapLayerRef.current.remove();
        basemapLayerRef.current = null;
      }
    };
  }, [showBasemap]);

  // Update tile layer
  useEffect(() => {
    if (!mapRef.current) return;

    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }

    if (tileUrl) {
      tileLayerRef.current = L.tileLayer(tileUrl, {
        attribution: '', // Remove attribution text
        maxZoom: 24,
        // Only enable tile buffering for main map to reduce memory usage
        keepBuffer: enableTileBuffering ? 5 : 0,
        edgeBufferTiles: enableTileBuffering ? 2 : 0,
        updateWhenIdle: !enableTileBuffering, // Update during panning only for main map
      }).addTo(mapRef.current);
    }

    return () => {
      if (tileLayerRef.current) {
        tileLayerRef.current.remove();
        tileLayerRef.current = null;
      }
    };
  }, [tileUrl]);

  // Update crosshair - only when center coordinates actually change
  useEffect(() => {
    if (!mapRef.current) return;

    // Remove crosshair if it shouldn't be shown
    if (!showCrosshair) {
      if (crosshairMarkerRef.current) {
        crosshairMarkerRef.current.remove();
        crosshairMarkerRef.current = null;
      }
      return;
    }

    // Update crosshair position without removing/recreating for smoother performance
    if (crosshairMarkerRef.current) {
      crosshairMarkerRef.current.setLatLng(center);
      return;
    }

    // Create plus sign crosshair only if it doesn't exist
    const svg = `
      <svg width="20" height="20" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none;">
        <line x1="0" y1="10" x2="20" y2="10" stroke="#${crosshairColor}" stroke-width="1.5"/>
        <line x1="10" y1="0" x2="10" y2="20" stroke="#${crosshairColor}" stroke-width="1.5"/>
      </svg>
    `;

    const crosshairIcon = L.divIcon({
      html: svg,
      className: 'crosshair-icon',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    crosshairMarkerRef.current = L.marker(center, { icon: crosshairIcon }).addTo(mapRef.current);

    return () => {
      if (crosshairMarkerRef.current) {
        crosshairMarkerRef.current.remove();
        crosshairMarkerRef.current = null;
      }
    };
  }, [center[0], center[1], showCrosshair, crosshairColor]);

  // Update crosshair color separately when it changes
  useEffect(() => {
    if (!mapRef.current || !crosshairMarkerRef.current) return;

    const svg = `
      <svg width="20" height="20" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none;">
        <line x1="0" y1="10" x2="20" y2="10" stroke="#${crosshairColor}" stroke-width="1.5"/>
        <line x1="10" y1="0" x2="10" y2="20" stroke="#${crosshairColor}" stroke-width="1.5"/>
      </svg>
    `;

    const crosshairIcon = L.divIcon({
      html: svg,
      className: 'crosshair-icon',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    crosshairMarkerRef.current.setIcon(crosshairIcon);
  }, [crosshairColor]);

  return (
    <>
      <div ref={containerRef} className="w-full h-full" />
      <style>{`
        /* Hide crosshair icon background */
        .crosshair-icon {
          background: transparent !important;
          border: none !important;
        }
        .leaflet-control-scale {
          font-size: 10px;
        }

        .leaflet-control-scale-line {
          font-size: 10px;
          line-height: 1.2;
        }
        
        /* Hardware acceleration for smoother map panning */
        .leaflet-container {
          will-change: transform;
        }
        
        .leaflet-tile-container {
          will-change: transform;
        }
        
        .leaflet-zoom-animated {
          will-change: transform;
        }
        
        /* Optimize tile rendering */
        .leaflet-tile {
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
        }
      `}</style>
    </>
  );
};

export default LeafletMap;
