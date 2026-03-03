/**
 * DrawingLayer
 *
 * A focused OpenLayers component that owns the annotation VectorLayer and all
 * drawing/editing interactions (Draw, Modify, Select, Translate).  It is a
 * thin slice of responsibility - it knows nothing about tile layers or STAC;
 * those live in the parent OpenModeMap.
 *
 * The component receives the raw OL Map instance from its parent (set once via
 * `onMapRef`) so that tile layers and the drawing layer share the same map
 * without either layer owning the map lifecycle.
 *
 * Behaviour summary:
 *   pan mode      - all interactions disabled; normal OL panning
 *   annotate mode - Draw interaction active for the geometry matching
 *                   selectedLabel; finishes -> saveAnnotation -> re-render
 *   edit mode     - Select + Modify + Translate active; clicking a feature
 *                   selects it; ESC cancels (restores saved geometry);
 *                   ✓ button commits the edited geometry; 🗑 button deletes
 *   timeseries    - timeseries-probe click handler
 */

import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import OLMap from 'ol/Map';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Draw, Modify, Select, Snap, Translate } from 'ol/interaction';
import { click as clickCondition, altKeyOnly } from 'ol/events/condition';
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style';
import { GeoJSON as OLGeoJSON } from 'ol/format';
import { toLonLat } from 'ol/proj';
import type OLFeature from 'ol/Feature';
import type { Geometry } from 'ol/geom';
import type { SelectEvent } from 'ol/interaction/Select';
import type { DrawEvent } from 'ol/interaction/Draw';

import type { ExtendedLabel } from '../ControlsOpenMode';
import { extendLabelsWithMetadata } from '../ControlsOpenMode';
import useAnnotationStore from '../../annotation.store';
import { convertWKTToGeoJSON, mockMagicWandSegmentation } from '~/shared/utils/utility';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Feature property keys stored on each OL Feature */
const PROP_ANNOTATION_ID = 'annotationId';
const PROP_LABEL_ID = 'labelId';

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

/** Build an OL style for a single annotation feature */
function buildStyle(
    color: string,
    selected = false,
    hovered = false,
    geometryType: ExtendedLabel['geometry_type'] = 'polygon',
): Style {
    const fillOpacity = selected ? 0.35 : hovered ? 0.25 : 0.2;
    const strokeWidth = selected ? 3 : hovered ? 2.5 : geometryType === 'line' ? 3 : 2;

    return new Style({
        fill: new Fill({ color: hexToRgba(color, fillOpacity) }),
        stroke: new Stroke({ color, width: strokeWidth }),
        image: new CircleStyle({
            radius: selected ? 8 : hovered ? 7 : 6,
            fill: new Fill({ color: hexToRgba(color, 0.85) }),
            stroke: new Stroke({ color: '#fff', width: 2 }),
        }),
    });
}

/** Build a transient draw-preview style (used during active drawing) */
function buildDrawStyle(color: string, geometryType: ExtendedLabel['geometry_type']): Style[] {
    return [
        new Style({
            fill: new Fill({ color: hexToRgba(color, 0.15) }),
            stroke: new Stroke({ color, width: geometryType === 'line' ? 3 : 2, lineDash: [6, 4] }),
            image: new CircleStyle({
                radius: 5,
                fill: new Fill({ color }),
                stroke: new Stroke({ color: '#fff', width: 1.5 }),
            }),
        }),
    ];
}

function hexToRgba(hex: string, alpha: number): string {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------------
// GeoJSON converter (OL ↔ GeoJSON) - reused across effects
// ---------------------------------------------------------------------------

const geoJsonFormat = new OLGeoJSON();

function olFeatureToGeoJSONGeometry(feature: OLFeature<Geometry>): GeoJSON.Geometry | null {
    try {
        const gj = geoJsonFormat.writeFeatureObject(feature, { featureProjection: 'EPSG:3857' });
        return (gj.geometry as GeoJSON.Geometry) ?? null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DrawingLayerProps {
    /** The OL map instance owned by the parent (tile layers already added). */
    map: OLMap;
    selectedLabel: ExtendedLabel | null;
    activeTool: 'pan' | 'annotate' | 'edit' | 'timeseries';
    magicWandActive: boolean;
    onTimeseriesClick?: (lat: number, lon: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DrawingLayer = ({
    map,
    selectedLabel,
    activeTool,
    magicWandActive,
    onTimeseriesClick,
}: DrawingLayerProps) => {
    // Store
    const annotations = useAnnotationStore((state) => state.annotations);
    const campaign = useAnnotationStore((state) => state.campaign);
    const saveAnnotation = useAnnotationStore((state) => state.saveAnnotation);
    const updateAnnotationGeometry = useAnnotationStore((state) => state.updateAnnotationGeometry);
    const deleteAnnotation = useAnnotationStore((state) => state.deleteAnnotation);

    const extendedLabels = useMemo(
        () => (campaign ? extendLabelsWithMetadata(campaign.settings.labels) : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [campaign?.settings.labels],
    );

    // OL objects held in refs (not state - no re-renders from these)
    const sourceRef = useRef<VectorSource<OLFeature<Geometry>> | null>(null);
    const vectorLayerRef = useRef<VectorLayer<VectorSource<OLFeature<Geometry>>> | null>(null);
    const drawInteractionRef = useRef<Draw | null>(null);
    const modifyInteractionRef = useRef<Modify | null>(null);
    const selectInteractionRef = useRef<Select | null>(null);
    const translateInteractionRef = useRef<Translate | null>(null);
    const snapInteractionRef = useRef<Snap | null>(null);
    // Track active tool in a ref so OL event callbacks always see the latest value
    const activeToolRef = useRef(activeTool);
    activeToolRef.current = activeTool;
    const selectedLabelRef = useRef(selectedLabel);
    selectedLabelRef.current = selectedLabel;
    const onTimeseriesClickRef = useRef(onTimeseriesClick);
    onTimeseriesClickRef.current = onTimeseriesClick;

    // React state (drives inline edit controls overlay)
    /** OL feature currently selected for editing */
    const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
    /** Pixel coords [x, y] of the top-right of the selected feature's bounding box */
    const [editControlsPos, setEditControlsPos] = useState<{ x: number; y: number } | null>(null);
    /** Saved geometry snapshot for ESC rollback */
    const originalGeometryRef = useRef<GeoJSON.Geometry | null>(null);

    // Timeseries probe marker (OL Overlay)
    // We use a simple DOM element positioned via map.getPixelFromCoordinate rather
    // than an OL Overlay so we avoid a separate overlay lifecycle.
    const probeMarkerRef = useRef<{ lat: number; lon: number } | null>(null);

    // 1. Create VectorSource + VectorLayer once
    useEffect(() => {
        const source = new VectorSource<OLFeature<Geometry>>();
        sourceRef.current = source;

        const layer = new VectorLayer({
            source,
            zIndex: 10, // always above tile layers
        });
        vectorLayerRef.current = layer;
        map.addLayer(layer);

        return () => {
            map.removeLayer(layer);
            sourceRef.current = null;
            vectorLayerRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, map is stable
    }, [map]);

    // 2. Sync annotation features from store into VectorSource
    useEffect(() => {
        const source = sourceRef.current;
        if (!source) return;

        // Build a Set of annotation IDs currently on the source for O(1) lookup
        const existing = new Map<number, OLFeature<Geometry>>();
        for (const feature of source.getFeatures()) {
            const id = feature.get(PROP_ANNOTATION_ID) as number;
            existing.set(id, feature);
        }

        const incomingIds = new Set<number>();

        for (const annotation of annotations) {
            const geoJSON = convertWKTToGeoJSON(annotation.geometry.geometry);
            if (!geoJSON) continue;

            incomingIds.add(annotation.id);
            const label = extendedLabels.find((l) => l.id === annotation.label_id);
            const color = label?.color ?? '#3b82f6';
            const geometryType = label?.geometry_type ?? 'polygon';

            if (existing.has(annotation.id)) {
                // Update geometry + style in-place if the WKT changed
                const existingFeature = existing.get(annotation.id)!;
                const existingGeoJSON = olFeatureToGeoJSONGeometry(existingFeature);
                if (JSON.stringify(existingGeoJSON) !== JSON.stringify(geoJSON)) {
                    const newGeom = geoJsonFormat.readGeometry(geoJSON, {
                        featureProjection: 'EPSG:3857',
                    }) as Geometry;
                    existingFeature.setGeometry(newGeom);
                }
                existingFeature.setStyle(buildStyle(color, false, false, geometryType));
            } else {
                // Add new feature
                const feature = geoJsonFormat.readFeature(
                    { type: 'Feature', geometry: geoJSON, properties: {} },
                    { featureProjection: 'EPSG:3857' },
                ) as OLFeature<Geometry>;
                feature.set(PROP_ANNOTATION_ID, annotation.id);
                feature.set(PROP_LABEL_ID, annotation.label_id);
                feature.setStyle(buildStyle(color, false, false, geometryType));
                source.addFeature(feature);
            }
        }

        // Remove features that are no longer in the store
        for (const [id, feature] of existing) {
            if (!incomingIds.has(id)) {
                source.removeFeature(feature);
            }
        }
    }, [annotations, extendedLabels]);

    // Helper: recompute edit controls position
    // Kept in a ref so interaction callbacks (modifyend, translateend) always
    // call the latest version without needing to be recreated.
    const refreshEditControlsPosRef = useRef<() => void>(() => {});

    const refreshEditControlsPos = useCallback(() => {
        const source = sourceRef.current;
        if (!source || !selectedFeatureId) { setEditControlsPos(null); return; }

        const feature = source.getFeatures().find(
            (f) => String(f.get(PROP_ANNOTATION_ID)) === selectedFeatureId,
        );
        if (!feature) { setEditControlsPos(null); return; }

        const extent = feature.getGeometry()?.getExtent();
        if (!extent) { setEditControlsPos(null); return; }

        // top-right corner of the bounding box -> screen pixels
        const pixel = map.getPixelFromCoordinate([extent[2], extent[3]]);
        if (!pixel) { setEditControlsPos(null); return; }
        setEditControlsPos({ x: pixel[0] + 10, y: pixel[1] - 5 });
    }, [map, selectedFeatureId]);

    // Keep the ref up-to-date every render so stale closures always reach the latest version
    refreshEditControlsPosRef.current = refreshEditControlsPos;

    // Continuously reposition the controls while editing:
    //   - map pan/zoom (moveend, view change)
    //   - vertex drag (pointermove fires every frame during any pointer drag)
    //   - translate drag (same)
    useEffect(() => {
        if (!selectedFeatureId) return;
        // pointermove fires on every mouse-move including during vertex drags,
        // keeping the buttons locked to the feature bounding box in real time.
        const handler = () => refreshEditControlsPosRef.current();
        map.on('pointermove', handler as any);
        map.on('moveend', handler);
        return () => {
            map.un('pointermove', handler as any);
            map.un('moveend', handler);
        };
    }, [map, selectedFeatureId]);

    useEffect(() => {
        refreshEditControlsPos();
    }, [selectedFeatureId, refreshEditControlsPos]);

    // 3. Manage interactions based on activeTool
    const removeAllInteractions = useCallback(() => {
        [
            drawInteractionRef,
            modifyInteractionRef,
            selectInteractionRef,
            translateInteractionRef,
            snapInteractionRef,
        ].forEach((ref) => {
            if (ref.current) {
                map.removeInteraction(ref.current);
                ref.current = null;
            }
        });
        setSelectedFeatureId(null);
        setEditControlsPos(null);
        originalGeometryRef.current = null;
        map.getTargetElement()?.style.setProperty('cursor', '');
    }, [map]);

    // 3a. Draw interaction (annotate mode)
    const setupDrawInteraction = useCallback(() => {
        const source = sourceRef.current;
        if (!source || !selectedLabel) return;

        const color = selectedLabel.color;
        const drawStyle = buildDrawStyle(color, selectedLabel.geometry_type);

        const olDrawType =
            selectedLabel.geometry_type === 'point' ? 'Point'
            : selectedLabel.geometry_type === 'line' ? 'LineString'
            : 'Polygon';

        const draw = new Draw({ source, type: olDrawType, style: drawStyle });

        draw.on('drawend', async (evt: DrawEvent) => {
            const feature = evt.feature as OLFeature<Geometry>;

            // Extract GeoJSON geometry (in EPSG:4326)
            const geoJSON = olFeatureToGeoJSONGeometry(feature);
            if (!geoJSON || !selectedLabelRef.current) {
                source.removeFeature(feature);
                return;
            }

            // Remove the transient feature - will be replaced by store reload
            source.removeFeature(feature);

            await saveAnnotation(geoJSON, selectedLabelRef.current.id);
        });

        map.addInteraction(draw);
        drawInteractionRef.current = draw;

        // Snap helps close polygons cleanly
        const snap = new Snap({ source });
        map.addInteraction(snap);
        snapInteractionRef.current = snap;

        map.getTargetElement()?.style.setProperty('cursor', 'crosshair');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map, selectedLabel, saveAnnotation]);

    // 3b. Magic-wand interaction (single click -> auto polygon)
    const magicWandAbortRef = useRef<AbortController | null>(null);

    const setupMagicWandInteraction = useCallback(() => {
        if (!selectedLabel) return;

        const controller = new AbortController();
        magicWandAbortRef.current = controller;

        const handleClick = async (evt: { coordinate: number[] }) => {
            if (controller.signal.aborted) return;
            const [lon, lat] = toLonLat(evt.coordinate);
            try {
                const polygonGeometry = await mockMagicWandSegmentation(lat, lon);
                if (controller.signal.aborted) return;
                if (selectedLabelRef.current) {
                    await saveAnnotation(polygonGeometry, selectedLabelRef.current.id);
                }
            } catch (err) {
                console.error('Magic wand segmentation failed:', err);
            }
        };

        map.on('click', handleClick as any);
        map.getTargetElement()?.style.setProperty('cursor', 'crosshair');

        return () => {
            controller.abort();
            map.un('click', handleClick as any);
            map.getTargetElement()?.style.setProperty('cursor', '');
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map, selectedLabel, saveAnnotation]);

    // 3c. Edit interaction (select + modify + translate)
    const setupEditInteractions = useCallback(() => {
        const source = sourceRef.current;
        if (!source) return;

        const select = new Select({
            condition: clickCondition,
            layers: [vectorLayerRef.current!],
            style: (feature) => {
                const labelId = feature.get(PROP_LABEL_ID) as number;
                const label = extendedLabels.find((l) => l.id === labelId);
                return buildStyle(label?.color ?? '#3b82f6', true, false, label?.geometry_type ?? 'polygon');
            },
        });

        select.on('select', (evt: SelectEvent) => {
            const selectedFeatures = evt.selected;
            if (selectedFeatures.length === 0) {
                setSelectedFeatureId(null);
                originalGeometryRef.current = null;
                return;
            }
            const feature = selectedFeatures[0];
            const annotationId = feature.get(PROP_ANNOTATION_ID) as number;
            // Snapshot current geometry for ESC rollback
            originalGeometryRef.current = olFeatureToGeoJSONGeometry(feature);
            setSelectedFeatureId(String(annotationId));
        });

        // Alt+drag moves the whole selected feature; normal drag edits vertices.
        // Translate is added BEFORE Modify so OL (reverse-priority) gives Modify
        // the first chance to handle pointer events - vertex handles win.
        const translate = new Translate({
            features: select.getFeatures(),
            condition: altKeyOnly,
        });
        translate.on('translateend', () => { refreshEditControlsPosRef.current(); });

        // Modify handles vertex drag, edge insertion and Delete-key vertex removal.
        // Added AFTER Translate -> processed FIRST by OL.
        const modify = new Modify({ features: select.getFeatures() });
        modify.on('modifyend', () => { refreshEditControlsPosRef.current(); });

        const snap = new Snap({ source });

        // Insertion order matters: Select first, then Translate, then Modify (highest priority).
        map.addInteraction(select);
        map.addInteraction(translate);
        map.addInteraction(modify);
        map.addInteraction(snap);

        selectInteractionRef.current = select;
        modifyInteractionRef.current = modify;
        translateInteractionRef.current = translate;
        snapInteractionRef.current = snap;

        // Hover styling - pointer over feature body, crosshair over vertex handles
        const handlePointerMove = (evt: { dragging: boolean; pixel: number[] }) => {
            if (evt.dragging) return;
            const features = map.getFeaturesAtPixel(evt.pixel, { layerFilter: (l) => l === vectorLayerRef.current });
            map.getTargetElement()?.style.setProperty('cursor', features.length > 0 ? 'pointer' : '');
        };
        map.on('pointermove', handlePointerMove as any);

        return () => {
            map.un('pointermove', handlePointerMove as any);
        };
    }, [map, extendedLabels]); // refreshEditControlsPos intentionally omitted - called via stable ref

    // 3d. Timeseries click handler
    const setupTimeseriesInteraction = useCallback(() => {
        const handleClick = (evt: { coordinate: number[] }) => {
            const [lon, lat] = toLonLat(evt.coordinate);
            probeMarkerRef.current = { lat, lon };
            onTimeseriesClickRef.current?.(lat, lon);
        };
        map.on('click', handleClick as any);
        map.getTargetElement()?.style.setProperty('cursor', 'crosshair');

        return () => {
            map.un('click', handleClick as any);
            probeMarkerRef.current = null;
            map.getTargetElement()?.style.setProperty('cursor', '');
        };
    }, [map]);

    // Main effect: tear down & rebuild interactions on mode change
    useEffect(() => {
        removeAllInteractions();
        let cleanup: (() => void) | undefined;

        if (activeTool === 'annotate' && selectedLabel) {
            if (magicWandActive && selectedLabel.geometry_type === 'polygon') {
                cleanup = setupMagicWandInteraction() ?? undefined;
            } else {
                setupDrawInteraction();
            }
        } else if (activeTool === 'edit') {
            cleanup = setupEditInteractions() ?? undefined;
        } else if (activeTool === 'timeseries') {
            cleanup = setupTimeseriesInteraction() ?? undefined;
        }

        return () => {
            cleanup?.();
            removeAllInteractions();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTool, selectedLabel?.id, selectedLabel?.geometry_type, magicWandActive]);

    // 4. ESC key: cancel edit and roll back
    useEffect(() => {
        if (!selectedFeatureId || activeTool !== 'edit') return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();

            const source = sourceRef.current;
            const select = selectInteractionRef.current;
            if (!source || !select) return;

            const feature = source.getFeatures().find(
                (f) => String(f.get(PROP_ANNOTATION_ID)) === selectedFeatureId,
            );

            if (feature && originalGeometryRef.current) {
                // Restore the saved geometry
                try {
                    const restored = geoJsonFormat.readGeometry(originalGeometryRef.current, {
                        featureProjection: 'EPSG:3857',
                    }) as Geometry;
                    feature.setGeometry(restored);
                } catch {
                    // fall through - feature will reload from store on next annotation update
                }
            }

            select.getFeatures().clear();
            setSelectedFeatureId(null);
            setEditControlsPos(null);
            originalGeometryRef.current = null;
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedFeatureId, activeTool]);

    // 5. Edit control handlers (confirm / delete)
    const handleConfirmEdit = useCallback(async () => {
        const source = sourceRef.current;
        const select = selectInteractionRef.current;
        if (!source || !select || !selectedFeatureId) return;

        const feature = source.getFeatures().find(
            (f) => String(f.get(PROP_ANNOTATION_ID)) === selectedFeatureId,
        );

        if (feature) {
            const annotationId = feature.get(PROP_ANNOTATION_ID) as number;
            const geoJSON = olFeatureToGeoJSONGeometry(feature);
            if (geoJSON) {
                try {
                    await updateAnnotationGeometry(annotationId, geoJSON);
                } catch (err) {
                    console.error('Failed to save geometry update:', err);
                }
            }
        }

        select.getFeatures().clear();
        setSelectedFeatureId(null);
        setEditControlsPos(null);
        originalGeometryRef.current = null;
    }, [selectedFeatureId, updateAnnotationGeometry]);

    const handleDeleteAnnotation = useCallback(async () => {
        const source = sourceRef.current;
        const select = selectInteractionRef.current;
        if (!source || !select || !selectedFeatureId) return;

        const feature = source.getFeatures().find(
            (f) => String(f.get(PROP_ANNOTATION_ID)) === selectedFeatureId,
        );

        if (feature) {
            const annotationId = feature.get(PROP_ANNOTATION_ID) as number;
            await deleteAnnotation(annotationId);
        }

        select.getFeatures().clear();
        setSelectedFeatureId(null);
        setEditControlsPos(null);
        originalGeometryRef.current = null;
    }, [selectedFeatureId, deleteAnnotation]);

    // Render
    // The map canvas is owned by the parent; we only render the floating edit controls.
    return editControlsPos && selectedFeatureId && activeTool === 'edit' ? (
        <div
            className="absolute z-[1000] flex gap-1 pointer-events-none"
            style={{ left: editControlsPos.x, top: editControlsPos.y }}
        >
            <button
                onClick={handleConfirmEdit}
                className="pointer-events-auto p-1.5 bg-green-500 text-white rounded-full shadow-lg hover:bg-green-600 transition-all hover:scale-110 cursor-pointer"
                title="Confirm edits (Enter)"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M20 6L9 17l-5-5" />
                </svg>
            </button>
            <button
                onClick={handleDeleteAnnotation}
                className="pointer-events-auto p-1.5 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 transition-all hover:scale-110 cursor-pointer"
                title="Delete annotation (Delete)"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
            </button>
        </div>
    ) : null;
};

export default memo(DrawingLayer);
