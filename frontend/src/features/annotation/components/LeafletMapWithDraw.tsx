import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import 'leaflet-edgebuffer';
import { rateLimitedTileLayer } from '~/shared/utils/RateLimitedTileLayer';
import type { ExtendedLabel, GeometryType } from './ControlsOpenMode';
import { extendLabelsWithMetadata } from './ControlsOpenMode';
import useAnnotationStore from '../annotation.store';
import { MAP_ANIMATION, MAP_STYLES, MAP_Z_INDEX, MARKER_ICON_SIZE } from '~/shared/utils/constants';
import { convertWKTToGeoJSON, mockMagicWandSegmentation } from '~/shared/utils/utility';

// Extended layer type with annotation metadata
// We use type assertion since Leaflet doesn't officially support custom properties
type AnnotationLayer = L.Layer & {
  _annotationId?: number;
  _layerId?: string;
  _labelInfo?: ExtendedLabel;
  options?: L.PathOptions & { pane?: string };
};

interface LeafletMapWithDrawProps {
  center: [number, number]; // [lat, lon]
  zoom: number;
  tileUrl: string;
  crosshairColor: string;
  refocusTrigger?: number;
  showCrosshair?: boolean; // Whether to show the crosshair (default: true)
  showBasemap?: boolean;
  basemapType?: 'carto-light' | 'esri-world-imagery' | 'opentopomap';
  zoomInTrigger?: number;
  zoomOutTrigger?: number;
  panTrigger?: { direction: 'up' | 'down' | 'left' | 'right'; count: number };
  selectedLabel: ExtendedLabel | null; // Currently selected label for drawing
  drawingEnabled: boolean; // Whether drawing mode is active
  activeTool: 'pan' | 'annotate' | 'edit' | 'timeseries'; // Active tool mode
  magicWandActive: boolean; // Whether magic wand is active for the current label
  onAnnotationCreated?: (geometry: GeoJSON.Geometry, label: ExtendedLabel) => void;
  onAnnotationClicked?: (annotationId: string, label: ExtendedLabel) => void;
  onAnnotationDeleted?: (annotationId: string) => void;
  onMapMove?: (
    center: [number, number],
    zoom: number,
    bounds: [number, number, number, number]
  ) => void; // Callback for map movement
  syncMapState?: boolean; // Whether this map should sync its state (main map in open mode)
  onTimeseriesClick?: (lat: number, lon: number) => void; // Callback for timeseries tool clicks
}

/**
 * LeafletMap with drawing capabilities for open mode annotation
 * Integrates leaflet-geoman for geometry creation and editing
 */
const LeafletMapWithDraw: React.FC<LeafletMapWithDrawProps> = ({
  center,
  zoom,
  tileUrl,
  crosshairColor,
  refocusTrigger,
  showCrosshair = true,
  showBasemap = false,
  basemapType = 'carto-light',
  zoomInTrigger,
  zoomOutTrigger,
  panTrigger,
  selectedLabel,
  drawingEnabled,
  activeTool,
  magicWandActive,
  onAnnotationCreated,
  onAnnotationClicked,
  onAnnotationDeleted,
  onMapMove,
  syncMapState = false,
  onTimeseriesClick,
}) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const basemapLayerRef = useRef<L.TileLayer | null>(null);
  const scaleControlRef = useRef<L.Control.Scale | null>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const timeseriesMarkerRef = useRef<L.Marker | null>(null);
  const crosshairMarkerRef = useRef<L.Marker | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [hoveredLayerId, setHoveredLayerId] = useState<string | null>(null);
  const [layersVersion, setLayersVersion] = useState(0); // Trigger to re-setup handlers
  const [originalGeometry, setOriginalGeometry] = useState<GeoJSON.Geometry | null>(null); // For rollback on ESC
  const [controlsUpdateTrigger, setControlsUpdateTrigger] = useState(0); // Trigger to reposition controls
  const currentDrawModeRef = useRef<string | null>(null); // Track current geoman draw mode

  // Get annotations from store
  const annotations = useAnnotationStore((state) => state.annotations);
  const campaign = useAnnotationStore((state) => state.campaign);
  const saveAnnotation = useAnnotationStore((state) => state.saveAnnotation);
  const updateAnnotationGeometry = useAnnotationStore((state) => state.updateAnnotationGeometry);
  const deleteAnnotation = useAnnotationStore((state) => state.deleteAnnotation);

  // Get extended labels with colors
  const extendedLabels = campaign ? extendLabelsWithMetadata(campaign.settings.labels) : [];

  // Track the last refocus trigger to detect actual refocus requests
  const lastRefocusTriggerRef = useRef<number | undefined>(refocusTrigger);
  const initializedRef = useRef(false);
  const initialCenterRef = useRef<[number, number]>(center);
  const initialZoomRef = useRef<number>(zoom);

  // Track zoom/pan triggers
  const lastZoomInTriggerRef = useRef<number | undefined>(zoomInTrigger);
  const lastZoomOutTriggerRef = useRef<number | undefined>(zoomOutTrigger);
  const lastPanTriggerRef = useRef<number | undefined>(panTrigger?.count);

  // Track previous annotations to avoid recreating layers unnecessarily
  const prevAnnotationsRef = useRef<typeof annotations>([]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center,
      zoom,
      zoomControl: false,
      attributionControl: false,
      keyboard: true,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true, // Enable for smoother marker zoom
      wheelPxPerZoomLevel: MAP_ANIMATION.WHEEL_PX_PER_ZOOM,
      // Improve smoothness
      preferCanvas: false,
      renderer: L.svg({ padding: 0.5 }),
      trackResize: true,
      inertia: false, // Disable momentum scrolling for more responsive feel
      worldCopyJump: false, // Prevent jarring when crossing date line
      zoomAnimationThreshold: MAP_ANIMATION.ZOOM_THRESHOLD, // Smooth zoom up to threshold levels
    });

    scaleControlRef.current = L.control
      .scale({
        position: 'bottomleft',
        metric: true,
        imperial: false,
        maxWidth: 80,
      })
      .addTo(map);

    // Create custom panes for better z-index control
    // This ensures edit handles appear above polygons
    if (!map.getPane('annotationsPane')) {
      const annotationsPane = map.createPane('annotationsPane');
      annotationsPane.style.zIndex = MAP_Z_INDEX.ANNOTATIONS_PANE.toString();
    }

    if (!map.getPane('editHandlesPane')) {
      const editHandlesPane = map.createPane('editHandlesPane');
      editHandlesPane.style.zIndex = MAP_Z_INDEX.EDIT_HANDLES_PANE.toString();
      editHandlesPane.style.pointerEvents = 'auto'; // Ensure handles can receive clicks
    }

    // Initialize feature group for drawn items with custom pane
    drawnItemsRef.current = new L.FeatureGroup();
    map.addLayer(drawnItemsRef.current);

    // Initialize geoman controls but hide the default toolbar (we use our custom controls)
    map.pm.addControls({
      position: 'topleft',
      drawMarker: false,
      drawPolygon: false,
      drawPolyline: false,
      drawCircle: false,
      drawCircleMarker: false,
      drawRectangle: false,
      drawText: false,
      editMode: false,
      dragMode: false,
      cutPolygon: false,
      removalMode: false,
      rotateMode: false,
    });

    // Hide the geoman toolbar completely - we use our custom controls
    map.pm.removeControls();

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Load existing annotations onto the map
  useEffect(() => {
    if (!mapRef.current || !drawnItemsRef.current) return;

    const map = mapRef.current;

    // Check if annotations actually changed to avoid unnecessary layer recreation
    const annotationsChanged =
      prevAnnotationsRef.current.length !== annotations.length ||
      prevAnnotationsRef.current.some((prev, idx) => {
        const curr = annotations[idx];
        return !curr || prev.id !== curr.id || prev.geometry.geometry !== curr.geometry.geometry;
      });

    if (!annotationsChanged) {
      // Annotations haven't changed, no need to recreate layers
      return;
    }

    prevAnnotationsRef.current = annotations;

    // Clear existing layers
    drawnItemsRef.current.clearLayers();

    // Add annotations to the map
    annotations.forEach((annotation) => {
      const geoJSON = convertWKTToGeoJSON(annotation.geometry.geometry);
      if (!geoJSON) return;

      // Find the label info for this annotation
      const label = extendedLabels.find((l) => l.id === annotation.label_id);
      const color = label?.color || '#3b82f6';
      const geometryType = label?.geometry_type || 'point';

      // Convert GeoJSON to Leaflet layer
      const layer = L.geoJSON(geoJSON, {
        pointToLayer: (feature, latlng) => {
          return L.marker(latlng, {
            icon: L.icon({
              iconUrl:
                'data:image/svg+xml;base64,' +
                btoa(`
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${MARKER_ICON_SIZE.DEFAULT}" height="${MARKER_ICON_SIZE.DEFAULT}">
                  <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2.5" opacity="0.9"/>
                </svg>
              `),
              iconSize: [MARKER_ICON_SIZE.DEFAULT, MARKER_ICON_SIZE.DEFAULT],
              iconAnchor: [MARKER_ICON_SIZE.ANCHOR_OFFSET, MARKER_ICON_SIZE.ANCHOR_OFFSET],
              popupAnchor: [0, MARKER_ICON_SIZE.POPUP_ANCHOR_Y],
            }),
            pmIgnore: false, // Allow geoman to edit this marker
          });
        },
        style: (feature) => {
          return {
            color: color,
            weight: geometryType === 'line' ? MAP_STYLES.LINE_WEIGHT : MAP_STYLES.POLYGON_WEIGHT,
            fillOpacity: MAP_STYLES.POLYGON_FILL_OPACITY,
            pane: 'annotationsPane',
            pmIgnore: false, // Allow geoman to edit this layer
          };
        },
        pmIgnore: false, // Allow geoman to edit layers
      }).getLayers()[0] as AnnotationLayer;

      if (layer && drawnItemsRef.current) {
        // Store annotation info on the layer
        layer._annotationId = annotation.id;
        layer._layerId = L.stamp(layer).toString();
        layer._labelInfo = label;

        drawnItemsRef.current.addLayer(layer);
      }
    });

    // Trigger handler setup for new layers
    setLayersVersion((v) => v + 1);
  }, [annotations, extendedLabels]);

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

  // Show/hide attribution based on basemap
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

  // Set initial center and zoom
  useEffect(() => {
    if (!mapRef.current) return;

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

  // Refocus when trigger changes — fit to annotation bounds if any exist
  useEffect(() => {
    if (!mapRef.current || refocusTrigger === undefined) return;

    if (lastRefocusTriggerRef.current !== refocusTrigger) {
      lastRefocusTriggerRef.current = refocusTrigger;

      // If there are drawn annotation layers, fit the map to their combined bounds
      if (drawnItemsRef.current && drawnItemsRef.current.getLayers().length > 0) {
        const bounds = drawnItemsRef.current.getBounds();
        if (bounds.isValid()) {
          mapRef.current.fitBounds(bounds, { padding: [40, 40], animate: true });
          return;
        }
      }

      // Fallback: reset to center/zoom (campaign bbox center)
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
          y = -MAP_ANIMATION.PAN_OFFSET_PIXELS;
          break;
        case 'down':
          y = MAP_ANIMATION.PAN_OFFSET_PIXELS;
          break;
        case 'left':
          x = -MAP_ANIMATION.PAN_OFFSET_PIXELS;
          break;
        case 'right':
          x = MAP_ANIMATION.PAN_OFFSET_PIXELS;
          break;
      }

      mapRef.current.panBy([x, y]);
    }
  }, [panTrigger?.count, panTrigger?.direction]);

  // Manage crosshair marker
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

  // Update basemap layer
  useEffect(() => {
    if (!mapRef.current) return;

    if (basemapLayerRef.current) {
      basemapLayerRef.current.remove();
      basemapLayerRef.current = null;
    }

    if (showBasemap) {
      let url: string;
      let attribution: string;
      let subdomains: string[] | undefined;
      let maxNativeZoom: number;

      if (basemapType === 'esri-world-imagery') {
        url =
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
        attribution =
          'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';
        maxNativeZoom = 17;
      } else if (basemapType === 'opentopomap') {
        url = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
        attribution =
          'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)';
        subdomains = ['a', 'b', 'c'];
        maxNativeZoom = 17;
      } else {
        // carto-light (default)
        url = 'http://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
        attribution =
          '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>';
        subdomains = ['a', 'b', 'c', 'd', 'e'];
        maxNativeZoom = 24;
      }

      const options: L.TileLayerOptions = {
        attribution,
        minZoom: 0,
        maxZoom: 24,
        maxNativeZoom,
        edgeBufferTiles: 2,
      };

      if (subdomains) {
        options.subdomains = subdomains;
      }

      basemapLayerRef.current = L.tileLayer(url, options).addTo(mapRef.current);
    }

    return () => {
      if (basemapLayerRef.current) {
        basemapLayerRef.current.remove();
        basemapLayerRef.current = null;
      }
    };
  }, [showBasemap, basemapType]);

  // Update tile layer
  useEffect(() => {
    if (!mapRef.current) return;

    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }

    if (tileUrl) {
      tileLayerRef.current = rateLimitedTileLayer(tileUrl, {
        attribution: '',
        minZoom: 0,
        maxZoom: 24,
        keepBuffer: 5,
        edgeBufferTiles: 2,
        updateWhenIdle: false,
      }).addTo(mapRef.current);
    }

    return () => {
      if (tileLayerRef.current) {
        tileLayerRef.current.remove();
        tileLayerRef.current = null;
      }
    };
  }, [tileUrl]);

  // Setup drawing controls based on selected label using geoman
  useEffect(() => {
    if (!mapRef.current || !drawnItemsRef.current) return;

    const map = mapRef.current;

    // Disable any active drawing mode
    if (currentDrawModeRef.current) {
      map.pm.disableDraw();
      currentDrawModeRef.current = null;
    }

    // Only enable drawing if label is selected and drawing is enabled
    if (!drawingEnabled || !selectedLabel) return;

    const color = selectedLabel.color;

    // Check if magic wand is active for polygon labels
    const isMagicWandMode = magicWandActive && selectedLabel.geometry_type === 'polygon';

    // Magic wand mode: use single click to auto-generate polygon
    if (isMagicWandMode) {
      let isMagicWandProcessing = false; // Prevent multiple simultaneous calls

      const handleMagicWandClick = async (e: L.LeafletMouseEvent) => {
        if (isMagicWandProcessing) return;
        isMagicWandProcessing = true;

        const { lat, lng } = e.latlng;

        try {
          // Call mock magic wand API
          const polygonGeometry = await mockMagicWandSegmentation(lat, lng);

          // Save annotation to backend
          const savedAnnotation = await saveAnnotation(polygonGeometry, selectedLabel.id);

          if (savedAnnotation) {
            console.log('Magic wand annotation created:', savedAnnotation.id);

            // Switch to edit mode
            useAnnotationStore.getState().setActiveTool('edit');

            // Wait for the annotation to be loaded and the layer to be created
            // We need to use a short delay to let React re-render with the new annotation
            setTimeout(() => {
              if (drawnItemsRef.current) {
                const layers = drawnItemsRef.current.getLayers();
                // Find the layer with the matching annotation ID
                const newLayer = layers.find(
                  (l: any) => l._annotationId === savedAnnotation.id
                ) as any;

                if (newLayer) {
                  const layerId = L.stamp(newLayer).toString();
                  newLayer._layerId = layerId;

                  // Store original geometry for potential rollback
                  const geoJSON = newLayer.toGeoJSON();
                  setOriginalGeometry(geoJSON.geometry);

                  // Select the layer for editing
                  setSelectedLayerId(layerId);
                  setIsEditing(true);

                  console.log('Selected magic wand annotation for editing:', layerId);
                }
              }
            }, 100); // Small delay to allow React to update
          }

          if (onAnnotationCreated && selectedLabel) {
            onAnnotationCreated(polygonGeometry, selectedLabel);
          }
        } catch (error) {
          console.error('Magic wand segmentation failed:', error);
        } finally {
          isMagicWandProcessing = false;
        }
      };

      // Add click handler for magic wand mode
      map.on('click', handleMagicWandClick);

      // Change cursor to indicate magic wand mode
      map.getContainer().style.cursor = 'crosshair';

      return () => {
        map.off('click', handleMagicWandClick);
        map.getContainer().style.cursor = '';
      };
    }

    // Regular drawing mode (not magic wand)
    // Configure geoman drawing options based on geometry type
    const markerOptions = {
      markerStyle: {
        icon: L.icon({
          iconUrl:
            'data:image/svg+xml;base64,' +
            btoa(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
              <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2.5" opacity="0.9"/>
            </svg>
          `),
          iconSize: [24, 24],
          iconAnchor: [12, 12],
          popupAnchor: [0, -12],
        }),
      },
    };

    const pathOptions = {
      templineStyle: { color: color, weight: 2 },
      hintlineStyle: { color: color, weight: 2, dashArray: '5,5' },
      pathOptions: {
        color: color,
        weight: selectedLabel.geometry_type === 'line' ? 3 : 2,
        fillOpacity: 0.2,
      },
    };

    // Enable appropriate drawing mode
    try {
      switch (selectedLabel.geometry_type) {
        case 'point':
          map.pm.enableDraw('Marker', markerOptions);
          currentDrawModeRef.current = 'Marker';
          break;
        case 'polygon':
          map.pm.enableDraw('Polygon', {
            ...pathOptions,
            allowSelfIntersection: true,
          });
          currentDrawModeRef.current = 'Polygon';
          break;
        case 'line':
          map.pm.enableDraw('Line', pathOptions);
          currentDrawModeRef.current = 'Line';
          break;
      }
    } catch (error) {
      console.error('Error enabling geoman draw mode:', error);
    }

    // Handle drawing completion (geoman event)
    const handleCreate = async (e: L.LayerEvent & { layer: L.Layer; shape?: string }) => {
      const layer = e.layer as AnnotationLayer;

      // Apply styling based on type
      if (selectedLabel.geometry_type === 'point') {
        if ('setIcon' in layer && typeof layer.setIcon === 'function') {
          layer.setIcon(
            L.icon({
              iconUrl:
                'data:image/svg+xml;base64,' +
                btoa(`
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
                <circle cx="12" cy="12" r="10" fill="${selectedLabel.color}" stroke="white" stroke-width="2.5" opacity="0.9"/>
              </svg>
            `),
              iconSize: [24, 24],
              iconAnchor: [12, 12],
              popupAnchor: [0, -12],
            })
          );
        }
      } else if (selectedLabel.geometry_type === 'polygon') {
        if ('setStyle' in layer && typeof layer.setStyle === 'function') {
          (layer as L.Polygon).setStyle({
            color: selectedLabel.color,
            weight: 2,
            fillOpacity: 0.2,
          });
        }
        if (layer.options) {
          layer.options.pane = 'annotationsPane';
        }
      } else if (selectedLabel.geometry_type === 'line') {
        if ('setStyle' in layer && typeof layer.setStyle === 'function') {
          (layer as L.Polyline).setStyle({
            color: selectedLabel.color,
            weight: 3,
          });
        }
        if (layer.options) {
          layer.options.pane = 'annotationsPane';
        }
      }

      // Convert layer to GeoJSON geometry
      const geoJSON = (layer as L.Marker | L.Polygon | L.Polyline).toGeoJSON();

      // Save annotation to backend
      if (selectedLabel) {
        const savedAnnotation = await saveAnnotation(geoJSON.geometry, selectedLabel.id);

        if (savedAnnotation) {
          // Store annotation ID on the layer
          (layer as any)._annotationId = savedAnnotation.id;
          (layer as any)._labelInfo = selectedLabel;
          (layer as any)._layerId = L.stamp(layer).toString();

          // Remove the layer from map (it will be reloaded from store)
          map.removeLayer(layer);
        } else {
          // Failed to save - remove the layer
          map.removeLayer(layer);
        }
      }

      // Call handler if provided
      if (onAnnotationCreated && selectedLabel) {
        onAnnotationCreated(geoJSON.geometry, selectedLabel);
      }

      // Re-enable drawing mode after creation
      setTimeout(() => {
        if (drawingEnabled && selectedLabel && currentDrawModeRef.current) {
          try {
            switch (selectedLabel.geometry_type) {
              case 'point':
                map.pm.enableDraw('Marker', markerOptions);
                break;
              case 'polygon':
                map.pm.enableDraw('Polygon', { ...pathOptions, allowSelfIntersection: true });
                break;
              case 'line':
                map.pm.enableDraw('Line', pathOptions);
                break;
            }
          } catch (e) {
            console.error('Error re-enabling draw mode:', e);
          }
        }
      }, 10);
    };

    map.on('pm:create', handleCreate);

    return () => {
      map.off('pm:create', handleCreate);
      if (currentDrawModeRef.current) {
        map.pm.disableDraw();
        currentDrawModeRef.current = null;
      }
    };
  }, [drawingEnabled, selectedLabel, magicWandActive, onAnnotationCreated, saveAnnotation]);

  // Handle layer selection and editing using geoman
  useEffect(() => {
    if (!mapRef.current || !drawnItemsRef.current) return;

    const layers = drawnItemsRef.current.getLayers();
    const map = mapRef.current;

    // Reset all layers to default style and handle geoman edit mode
    layers.forEach((layer: any) => {
      if (layer._labelInfo) {
        const isSelected = layer._layerId === selectedLayerId;
        const isHovered = layer._layerId === hoveredLayerId;

        if (layer instanceof L.Marker) {
          // Marker styling - update opacity for selection/hover
          if (isSelected && activeTool === 'edit') {
            layer.setOpacity(1);
            // Enable geoman edit mode for selected marker
            try {
              (layer as L.Marker).pm.enable({ draggable: true });
            } catch (e) {
              console.error('Error enabling marker edit:', e);
            }
          } else if (isHovered && activeTool === 'edit') {
            layer.setOpacity(0.85);
            (layer as L.Marker).pm.disable();
          } else {
            layer.setOpacity(0.7);
            // Disable editing for non-selected markers
            (layer as L.Marker).pm.disable();
          }
        } else if (layer instanceof L.Polygon) {
          (layer as L.Polygon).setStyle({
            color: (layer as any)._labelInfo.color,
            weight: isSelected ? 3 : isHovered && activeTool === 'edit' ? 2.5 : 2,
            fillOpacity: isSelected ? 0.3 : isHovered && activeTool === 'edit' ? 0.25 : 0.2,
            dashArray: isHovered && activeTool === 'edit' && !isSelected ? '5, 5' : '',
          });

          // Handle polygon editing with geoman
          if (isSelected && activeTool === 'edit') {
            try {
              if ((layer as any).bringToFront) {
                (layer as any).bringToFront();
              }
              // Enable geoman vertex editing
              console.log('Enabling polygon edit for:', (layer as any)._layerId);
              (layer as any).pm.enable({
                allowSelfIntersection: true,
                snappable: true,
                preventMarkerRemoval: false, // Allow vertex removal
                markerEditable: true, // Make vertices draggable
              });

              // Ensure vertex markers are on top by setting their z-index
              setTimeout(() => {
                const markers = document.querySelectorAll('.marker-icon, .marker-icon-middle');
                markers.forEach((marker: Element) => {
                  (marker as HTMLElement).style.zIndex = '1000';
                });
              }, 10);
            } catch (e) {
              console.error('Error enabling polygon editing:', e);
            }
          } else {
            try {
              (layer as any).pm.disable();
            } catch (e) {
              // Ignore errors during disable
            }
          }
        } else if (layer instanceof L.Polyline) {
          (layer as any).setStyle({
            color: (layer as any)._labelInfo.color,
            weight: isSelected ? 4 : isHovered && activeTool === 'edit' ? 3.5 : 3,
            dashArray: isHovered && activeTool === 'edit' && !isSelected ? '5, 5' : '',
          });

          // Handle polyline editing with geoman
          if (isSelected && activeTool === 'edit') {
            try {
              if ((layer as any).bringToFront) {
                (layer as any).bringToFront();
              }
              console.log('Enabling polyline edit for:', (layer as any)._layerId);
              (layer as any).pm.enable({
                snappable: true,
                preventMarkerRemoval: false,
                markerEditable: true,
              });

              // Ensure vertex markers are on top
              setTimeout(() => {
                const markers = document.querySelectorAll('.marker-icon, .marker-icon-middle');
                markers.forEach((marker: Element) => {
                  (marker as HTMLElement).style.zIndex = '1000';
                });
              }, 10);
            } catch (e) {
              console.error('Error enabling polyline editing:', e);
            }
          } else {
            try {
              (layer as any).pm.disable();
            } catch (e) {
              // Ignore errors during disable
            }
          }
        }
      }
    });
  }, [selectedLayerId, hoveredLayerId, activeTool]);

  // Update controls position when map moves or layer is edited
  useEffect(() => {
    if (!mapRef.current || !selectedLayerId || !isEditing) return;

    const map = mapRef.current;

    const updateControlsPosition = () => {
      setControlsUpdateTrigger((prev) => prev + 1);
    };

    // Listen to map move events
    map.on('move', updateControlsPosition);
    map.on('zoom', updateControlsPosition);

    // Listen to geoman edit events on the selected layer
    if (drawnItemsRef.current) {
      const layers = drawnItemsRef.current.getLayers();
      const selectedLayer = layers.find((l: any) => l._layerId === selectedLayerId) as any;

      if (selectedLayer && selectedLayer.pm) {
        selectedLayer.on('pm:edit', updateControlsPosition);
        selectedLayer.on('pm:drag', updateControlsPosition);
        selectedLayer.on('pm:vertexadded', updateControlsPosition);
        selectedLayer.on('pm:vertexremoved', updateControlsPosition);

        // Check for invalid polygon after vertex removal
        const handleVertexRemoved = () => {
          updateControlsPosition();

          // Check if it's a polygon and validate vertex count
          if (selectedLayer instanceof L.Polygon) {
            const latLngs = selectedLayer.getLatLngs()[0] as L.LatLng[];

            // A polygon needs at least 3 vertices
            if (latLngs.length < 3) {
              console.log('Polygon has insufficient vertices, auto-deleting');
              // Automatically delete the polygon
              setTimeout(() => {
                handleDelete();
              }, 100); // Small delay to allow the edit to complete
            }
          } else if (selectedLayer instanceof L.Polyline && !(selectedLayer instanceof L.Polygon)) {
            const latLngs = selectedLayer.getLatLngs() as L.LatLng[];

            // A line needs at least 2 vertices
            if (latLngs.length < 2) {
              console.log('Line has insufficient vertices, auto-deleting');
              // Automatically delete the line
              setTimeout(() => {
                handleDelete();
              }, 100);
            }
          }
        };

        selectedLayer.on('pm:vertexremoved', handleVertexRemoved);
      }
    }

    return () => {
      map.off('move', updateControlsPosition);
      map.off('zoom', updateControlsPosition);

      if (drawnItemsRef.current) {
        const layers = drawnItemsRef.current.getLayers();
        const selectedLayer = layers.find((l: any) => l._layerId === selectedLayerId) as any;

        if (selectedLayer) {
          selectedLayer.off('pm:edit', updateControlsPosition);
          selectedLayer.off('pm:drag', updateControlsPosition);
          selectedLayer.off('pm:vertexadded', updateControlsPosition);
          selectedLayer.off('pm:vertexremoved');
        }
      }
    };
  }, [selectedLayerId, isEditing]);

  // Handle delete button
  const handleDelete = async () => {
    if (!selectedLayerId || !drawnItemsRef.current) return;

    const layers = drawnItemsRef.current.getLayers();
    const layerToDelete = layers.find((l: any) => l._layerId === selectedLayerId);

    if (layerToDelete) {
      const annotationId = (layerToDelete as any)._annotationId;

      // Disable geoman editing before deletion
      (layerToDelete as any).pm?.disable();

      if (annotationId) {
        // Delete from backend
        await deleteAnnotation(annotationId);
      }

      // Layer will be removed automatically when annotations are reloaded
      if (onAnnotationDeleted) {
        onAnnotationDeleted(selectedLayerId);
      }
      setSelectedLayerId(null);
      setIsEditing(false);
      setOriginalGeometry(null);
    }
  };

  // Handle finish editing - save changes
  const handleFinishEdit = async () => {
    if (!selectedLayerId || !drawnItemsRef.current) return;

    const layers = drawnItemsRef.current.getLayers();
    const layer = layers.find((l: any) => l._layerId === selectedLayerId);

    if (layer) {
      // Disable geoman editing
      (layer as any).pm?.disable();

      const annotationId = (layer as any)._annotationId;

      if (annotationId) {
        // Save the updated geometry
        const geoJSON = (layer as any).toGeoJSON();

        try {
          await updateAnnotationGeometry(annotationId, geoJSON.geometry);
          // Successfully saved
          setOriginalGeometry(null);
        } catch (error) {
          // Failed to save - geometry will be rolled back by reload
          console.error('Failed to save geometry update:', error);
        }
      }
    }

    setSelectedLayerId(null);
    setIsEditing(false);
  };

  // Handle ESC key to cancel editing and rollback
  useEffect(() => {
    if (!isEditing || !selectedLayerId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();

        // Cancel editing and rollback to original geometry
        if (originalGeometry && drawnItemsRef.current && mapRef.current) {
          const layers = drawnItemsRef.current.getLayers();
          const layer = layers.find((l: any) => l._layerId === selectedLayerId) as any;

          if (layer) {
            console.log('Reverting to original geometry');

            // Disable geoman editing first
            try {
              layer.pm?.disable();
            } catch (e) {
              console.error('Error disabling edit mode:', e);
            }

            // Restore the original geometry
            try {
              if (layer instanceof L.Marker) {
                // For markers, restore the position
                if (originalGeometry.type === 'Point') {
                  const coords = originalGeometry.coordinates as [number, number];
                  layer.setLatLng([coords[1], coords[0]]);
                }
              } else if (layer instanceof L.Polygon) {
                // For polygons, restore the coordinates
                if (originalGeometry.type === 'Polygon') {
                  const coords = originalGeometry.coordinates[0].map(
                    (coord: number[]) => [coord[1], coord[0]] as [number, number]
                  );
                  layer.setLatLngs(coords);
                }
              } else if (layer instanceof L.Polyline) {
                // For polylines, restore the coordinates
                if (originalGeometry.type === 'LineString') {
                  const coords = originalGeometry.coordinates.map(
                    (coord: number[]) => [coord[1], coord[0]] as [number, number]
                  );
                  layer.setLatLngs(coords);
                }
              }
            } catch (error) {
              console.error('Error restoring geometry:', error);
            }

            // Clear selection
            setSelectedLayerId(null);
            setIsEditing(false);
            setOriginalGeometry(null);
          }
        } else {
          // No original geometry, just cancel
          setSelectedLayerId(null);
          setIsEditing(false);
          setOriginalGeometry(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditing, selectedLayerId, originalGeometry]);

  // Clear selection and disable geoman editing when switching away from edit mode
  useEffect(() => {
    if (activeTool !== 'edit') {
      // Disable geoman editing on all layers
      if (drawnItemsRef.current) {
        drawnItemsRef.current.getLayers().forEach((layer: any) => {
          layer.pm?.disable();
        });
      }
      setSelectedLayerId(null);
      setHoveredLayerId(null);
      setIsEditing(false);
    }
  }, [activeTool]);

  // Handle timeseries tool clicks
  useEffect(() => {
    if (!mapRef.current || !onTimeseriesClick) return;

    const map = mapRef.current;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (activeTool === 'timeseries') {
        onTimeseriesClick(e.latlng.lat, e.latlng.lng);

        // Add/update marker to show selected point
        if (timeseriesMarkerRef.current) {
          timeseriesMarkerRef.current.setLatLng(e.latlng);
        } else {
          const markerIcon = L.divIcon({
            html: `
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="8" cy="8" r="6" fill="rgb(59, 130, 246)" stroke="white" stroke-width="2"/>
              </svg>
            `,
            className: 'timeseries-marker',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          });

          timeseriesMarkerRef.current = L.marker(e.latlng, { icon: markerIcon }).addTo(map);
        }
      }
    };

    map.on('click', handleMapClick);

    return () => {
      map.off('click', handleMapClick);
    };
  }, [activeTool, onTimeseriesClick]);

  // Remove timeseries marker when tool is deselected
  useEffect(() => {
    if (activeTool !== 'timeseries' && timeseriesMarkerRef.current) {
      timeseriesMarkerRef.current.remove();
      timeseriesMarkerRef.current = null;
    }
  }, [activeTool]);

  // Setup interactive handlers for edit mode
  useEffect(() => {
    if (!drawnItemsRef.current) return;

    const layers = drawnItemsRef.current.getLayers();

    layers.forEach((layer: any) => {
      // Remove old handlers to prevent duplicates
      layer.off('mouseover');
      layer.off('mouseout');
      layer.off('click');

      if (activeTool === 'edit') {
        // Add hover handlers
        layer.on('mouseover', () => {
          setHoveredLayerId(L.stamp(layer).toString());
        });

        layer.on('mouseout', () => {
          setHoveredLayerId(null);
        });

        // Add click handler
        layer.on('click', (clickEvent: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(clickEvent);
          const layerId = L.stamp(layer).toString();

          // Store original geometry for rollback
          const geoJSON = layer.toGeoJSON();
          setOriginalGeometry(geoJSON.geometry);

          setSelectedLayerId(layerId);
          setIsEditing(true);

          if (onAnnotationClicked && layer._labelInfo) {
            onAnnotationClicked(layerId, layer._labelInfo);
          }
        });
      }
    });

    // Cleanup function
    return () => {
      if (!drawnItemsRef.current) return;
      const layers = drawnItemsRef.current.getLayers();
      layers.forEach((layer: any) => {
        layer.off('mouseover');
        layer.off('mouseout');
        layer.off('click');
      });
    };
  }, [activeTool, layersVersion, onAnnotationClicked]);

  return (
    <>
      <div ref={containerRef} className="w-full h-full relative">
        {/* Edit controls overlay - positioned near the selected geometry */}
        {selectedLayerId &&
          isEditing &&
          activeTool === 'edit' &&
          (() => {
            // Calculate position of selected layer
            if (!mapRef.current || !drawnItemsRef.current) return null;

            const layers = drawnItemsRef.current.getLayers();
            const selectedLayer = layers.find((l: any) => l._layerId === selectedLayerId) as any;

            if (!selectedLayer) return null;

            // Validate geometry has enough vertices before trying to get bounds
            if (selectedLayer instanceof L.Polygon) {
              try {
                const latLngs = selectedLayer.getLatLngs()[0] as L.LatLng[];
                if (!latLngs || latLngs.length < 3) {
                  // Invalid polygon, don't render controls
                  return null;
                }
              } catch (e) {
                return null;
              }
            } else if (
              selectedLayer instanceof L.Polyline &&
              !(selectedLayer instanceof L.Polygon)
            ) {
              try {
                const latLngs = selectedLayer.getLatLngs() as L.LatLng[];
                if (!latLngs || latLngs.length < 2) {
                  // Invalid line, don't render controls
                  return null;
                }
              } catch (e) {
                return null;
              }
            }

            let bounds: L.LatLngBounds | null = null;

            // Get bounds based on layer type
            try {
              if (selectedLayer instanceof L.Marker) {
                const latlng = selectedLayer.getLatLng();
                if (!latlng) return null;
                bounds = L.latLngBounds([latlng, latlng]);
              } else if (selectedLayer.getBounds) {
                bounds = selectedLayer.getBounds();
              }
            } catch (e) {
              console.error('Error getting layer bounds:', e);
              return null;
            }

            if (!bounds || !bounds.isValid()) return null;

            // Convert to screen coordinates (top-right of the bounding box)
            const ne = bounds.getNorthEast();
            if (!ne || ne.lat === undefined || ne.lng === undefined) return null;

            const point = mapRef.current.latLngToContainerPoint(ne);

            return (
              <div
                className="absolute z-[1000] flex gap-1"
                style={{
                  left: `${point.x + 10}px`,
                  top: `${point.y - 5}px`,
                  pointerEvents: 'auto',
                }}
              >
                <button
                  onClick={handleFinishEdit}
                  className="p-1.5 bg-green-500 text-white rounded-full shadow-lg hover:bg-green-600 transition-all hover:scale-110 cursor-pointer"
                  title="Confirm edits (Enter)"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </button>
                <button
                  onClick={handleDelete}
                  className="p-1.5 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 transition-all hover:scale-110 cursor-pointer"
                  title="Delete annotation (Delete)"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </button>
              </div>
            );
          })()}
      </div>
      <style>{`
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
          cursor: crosshair;
        }
        .leaflet-container.leaflet-drag-target {
          cursor: move;
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

        /* Hatched pattern for 204 no-content tiles */
        .leaflet-tile-no-content {
          opacity: 1 !important;
        }

        /* Red-tinted hatched pattern for tiles that failed after all retries */
        .leaflet-tile-error {
          opacity: 0.8 !important;
        }

        /* Hide geoman default toolbar (we use custom controls) */
        .leaflet-pm-toolbar {
          display: none !important;
        }
        
        /* Geoman drawing tooltip styling */
        .leaflet-pm-toolbar-action {
          display: none !important;
        }
        
        /* Improve drawing UX */
        .leaflet-marker-icon,
        .leaflet-marker-shadow {
          transition: none !important;
        }
        
        .leaflet-interactive {
          cursor: pointer;
        }
        
        /* Reduce visual jank during drawing */
        .leaflet-overlay-pane svg {
          pointer-events: auto;
        }
        
        /* Ensure edit markers are clickable and above polygons */
        .leaflet-marker-pane {
          z-index: 1000 !important;
          pointer-events: auto !important;
        }
        
        .leaflet-pane {
          z-index: auto;
        }
        
        /* Timeseries marker styling */
        .timeseries-marker {
          background: transparent !important;
          border: none !important;
        }
        
        /* Geoman edit handles styling */
        .marker-icon-middle,
        .marker-icon {
          cursor: move !important;
          z-index: 1000 !important; /* Ensure handles are above polygons */
        }
        
        /* Geoman vertex markers need higher z-index */
        .leaflet-marker-pane .leaflet-marker-icon {
          z-index: 1000 !important;
        }
        
        /* Geoman edit layer should be above annotations */
        .leaflet-overlay-pane .leaflet-pm-layer {
          z-index: 1000 !important;
        }
        
        /* Make geoman snap guides more visible */
        .leaflet-pm-snap-guide-layer {
          stroke: #3b82f6;
          stroke-opacity: 0.6;
        }
      `}</style>
    </>
  );
};

export default LeafletMapWithDraw;
