/**
 * DrawingLayer
 *
 * OL component that owns the annotation VectorLayer and all
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
 *                   selects it; Ctrl+click toggles features in/out of a
 *                   multi-selection; Shift+drag box-selects; ESC cancels
 *                   (restores saved geometry); Delete/Backspace removes the
 *                   selection; ✓ button commits the edited geometry; 🗑 deletes
 *   timeseries    - timeseries-probe click handler
 */

import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import OLMap from 'ol/Map';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Draw, Modify, Snap, Translate, DragBox } from 'ol/interaction';
import { altKeyOnly, shiftKeyOnly } from 'ol/events/condition';
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style';
import { GeoJSON as OLGeoJSON } from 'ol/format';
import { createEmpty, extend as extendExtent, isEmpty } from 'ol/extent';
import { toLonLat } from 'ol/proj';
import { hexToRgba, ANNOTATION_LAYER_Z_INDEX, ANNOTATION_TILE_LAYER_FLAG } from './mapUtils';
import type OLFeature from 'ol/Feature';
import type { Geometry } from 'ol/geom';
import type { DrawEvent } from 'ol/interaction/Draw';

import { extendLabelsWithMetadata, type ExtendedLabel } from '../../utils/labelMetadata';
import { missingRequiredFields } from '../../utils/formValues';
import { useAnnotationStore } from '../../stores/annotation.store';
import { useCampaignStore } from '../../stores/campaign.store';
import { useMapStore, type AnnotationTool } from '../../stores/map.store';
import { usePreferencesStore } from '../../stores/preferences.store';
import { useTaskStore } from '../../stores/task.store';
import {
  resolveLabelStyle,
  styleKey,
  emphasizedFillOpacity,
  emphasizedStrokeWidth,
  type LabelStyle,
} from '../../utils/annotationStyle';
import { convertWKTToGeoJSON, mockMagicWandSegmentation } from '~/shared/utils/utility';
import { handleError } from '~/shared/utils/errorHandler';
import { getAnnotation as getAnnotationApi, getAnnotationIdsInBbox } from '~/api/client';

const PROP_ANNOTATION_ID = 'annotationId';
const PROP_LABEL_ID = 'labelId';

function buildStyle(style: LabelStyle, selected = false, hovered = false): Style {
  const fillOpacity = emphasizedFillOpacity(style.fillOpacity, { selected, hovered });
  const strokeWidth = emphasizedStrokeWidth(style.strokeWidth, { selected, hovered });

  return new Style({
    fill: new Fill({ color: hexToRgba(style.fillColor, fillOpacity) }),
    stroke: new Stroke({
      color: hexToRgba(style.strokeColor, style.strokeOpacity),
      width: strokeWidth,
    }),
    image: new CircleStyle({
      radius: selected ? 8 : hovered ? 7 : 6,
      fill: new Fill({ color: hexToRgba(style.fillColor, fillOpacity) }),
      stroke: new Stroke({
        color: hexToRgba(style.strokeColor, style.strokeOpacity),
        width: strokeWidth,
      }),
    }),
  });
}

function buildDrawStyle(style: LabelStyle): Style[] {
  return [
    new Style({
      fill: new Fill({ color: hexToRgba(style.fillColor, Math.min(style.fillOpacity, 0.15)) }),
      stroke: new Stroke({
        color: hexToRgba(style.strokeColor, style.strokeOpacity),
        width: style.strokeWidth,
        lineDash: [6, 4],
      }),
      image: new CircleStyle({
        radius: 5,
        fill: new Fill({ color: hexToRgba(style.fillColor, style.fillOpacity) }),
        stroke: new Stroke({
          color: hexToRgba(style.strokeColor, style.strokeOpacity),
          width: style.strokeWidth,
        }),
      }),
    }),
  ];
}

const geoJsonFormat = new OLGeoJSON();

function olFeatureToGeoJSONGeometry(feature: OLFeature<Geometry>): GeoJSON.Geometry | null {
  try {
    const gj = geoJsonFormat.writeFeatureObject(feature, { featureProjection: 'EPSG:3857' });
    return (gj.geometry as GeoJSON.Geometry) ?? null;
  } catch {
    return null;
  }
}

export interface DrawingLayerProps {
  /** The OL map instance owned by the parent (tile layers already added). */
  map: OLMap;
  selectedLabel: ExtendedLabel | null;
  activeTool: AnnotationTool;
  magicWandActive: boolean;
  onTimeseriesClick?: (lat: number, lon: number) => void;
}

const DrawingLayer = ({
  map,
  selectedLabel,
  activeTool,
  magicWandActive,
  onTimeseriesClick,
}: DrawingLayerProps) => {
  // Store
  const campaign = useCampaignStore((state) => state.campaign);
  const saveAnnotation = useAnnotationStore((state) => state.saveAnnotation);
  const updateAnnotationGeometry = useAnnotationStore((state) => state.updateAnnotationGeometry);
  const deleteAnnotation = useAnnotationStore((state) => state.deleteAnnotation);
  const batchDeleteAnnotations = useAnnotationStore((state) => state.batchDeleteAnnotations);
  const setSelectedAnnotationIds = useAnnotationStore((state) => state.setSelectedAnnotationIds);
  const setEditingId = useAnnotationStore((state) => state.setEditingId);
  const styleOverrides = usePreferencesStore((state) => state.annotationStyles);
  const showAnnotations = useMapStore((state) => state.showAnnotations);
  const draftGeometry = useTaskStore((state) => state.draftGeometry);
  const draftLabelId = useTaskStore((state) => state.draftLabelId);

  const campaignId = campaign?.id ?? null;

  // Resolve a label's effective style (user override layered on the default color)
  const styleForLabel = useCallback(
    (label: Pick<ExtendedLabel, 'id' | 'color' | 'geometry_type'>): LabelStyle =>
      resolveLabelStyle(
        label.color,
        label.geometry_type,
        campaignId !== null ? styleOverrides[styleKey(campaignId, label.id)] : undefined
      ),
    [campaignId, styleOverrides]
  );

  const extendedLabels = useMemo(
    () => (campaign ? extendLabelsWithMetadata(campaign.settings.labels) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaign?.settings.labels]
  );

  // OL objects held in refs (not state - no re-renders from these)
  const sourceRef = useRef<VectorSource<OLFeature<Geometry>> | null>(null);
  const vectorLayerRef = useRef<VectorLayer<VectorSource<OLFeature<Geometry>>> | null>(null);
  const drawInteractionRef = useRef<Draw | null>(null);
  const modifyInteractionRef = useRef<Modify | null>(null);
  const translateInteractionRef = useRef<Translate | null>(null);
  const snapInteractionRef = useRef<Snap | null>(null);
  const dragBoxInteractionRef = useRef<DragBox | null>(null);
  // Track active tool in a ref so OL event callbacks always see the latest value
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const selectedLabelRef = useRef(selectedLabel);
  selectedLabelRef.current = selectedLabel;
  const onTimeseriesClickRef = useRef(onTimeseriesClick);
  onTimeseriesClickRef.current = onTimeseriesClick;
  // Lets ESC distinguish aborting an in-progress sketch from closing a draft.
  const isDrawingRef = useRef(false);

  // React state (drives inline edit controls overlay)
  /** OL features currently selected for editing (annotation ids as strings). */
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([]);
  /** Pixel coords [x, y] of the top-right of the selection's bounding box */
  const [editControlsPos, setEditControlsPos] = useState<{ x: number; y: number } | null>(null);
  /** Saved geometry snapshots (annotationId -> geometry) for ESC rollback */
  const originalGeometriesRef = useRef<Map<number, GeoJSON.Geometry>>(new Map());

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
      zIndex: ANNOTATION_LAYER_Z_INDEX,
    });
    layer.setVisible(useMapStore.getState().showAnnotations);
    vectorLayerRef.current = layer;
    map.addLayer(layer);

    return () => {
      map.removeLayer(layer);
      sourceRef.current = null;
      vectorLayerRef.current = null;
    };
  }, [map]);

  // Toggle visibility of all drawn objects (D / eye button in open-mode controls)
  useEffect(() => {
    vectorLayerRef.current?.setVisible(showAnnotations);
  }, [showAnnotations]);

  // Paint the open-mode draft as a dashed feature, fully derived from store
  // state so commit/discard clears the draft and this cleanup removes it.
  useEffect(() => {
    const source = sourceRef.current;
    if (!source || !draftGeometry) return;
    const label = extendedLabels.find((l) => l.id === draftLabelId);
    if (!label) return;
    const feature = geoJsonFormat.readFeature(
      { type: 'Feature', geometry: draftGeometry, properties: {} },
      { featureProjection: 'EPSG:3857' }
    ) as OLFeature<Geometry>;
    feature.setStyle(buildDrawStyle(styleForLabel(label)));
    source.addFeature(feature);
    return () => {
      try {
        source.removeFeature(feature);
      } catch {
        /* already gone */
      }
    };
  }, [draftGeometry, draftLabelId, extendedLabels, styleForLabel]);

  // 2. Existing annotations render via the read-only vector-tile layer (see
  // useAnnotationTileLayer). The VectorSource here holds only the transient
  // feature(s) being drawn or geometry-edited; nothing is synced into it.

  // Helper: recompute edit controls position
  // Kept in a ref so interaction callbacks (modifyend, translateend) always
  // call the latest version without needing to be recreated.
  const refreshEditControlsPosRef = useRef<() => void>(() => {});

  const refreshEditControlsPos = useCallback(() => {
    const source = sourceRef.current;
    if (!source || selectedFeatureIds.length === 0) {
      setEditControlsPos(null);
      return;
    }

    const selected = new Set(selectedFeatureIds);
    const union = createEmpty();
    for (const feature of source.getFeatures()) {
      if (!selected.has(String(feature.get(PROP_ANNOTATION_ID)))) continue;
      const extent = feature.getGeometry()?.getExtent();
      if (extent) extendExtent(union, extent);
    }
    // Multi-select (box) lives in the tile layer, not the edit source, so there
    // is nothing to recompute from - keep the position set at boxend.
    if (isEmpty(union)) return;

    // top-right corner of the combined bounding box -> screen pixels
    const pixel = map.getPixelFromCoordinate([union[2], union[3]]);
    if (!pixel) {
      setEditControlsPos(null);
      return;
    }
    setEditControlsPos({ x: pixel[0] + 10, y: pixel[1] - 5 });
  }, [map, selectedFeatureIds]);

  // Keep the ref up-to-date every render so stale closures always reach the latest version
  refreshEditControlsPosRef.current = refreshEditControlsPos;

  // Continuously reposition the controls while editing:
  //   - map pan/zoom (moveend, view change)
  //   - vertex drag (pointermove fires every frame during any pointer drag)
  //   - translate drag (same)
  useEffect(() => {
    if (selectedFeatureIds.length === 0) return;
    // pointermove fires on every mouse-move including during vertex drags,
    // keeping the buttons locked to the selection bounding box in real time.
    const handler = () => refreshEditControlsPosRef.current();
    map.on('pointermove', handler as unknown as () => void);
    map.on('moveend', handler);
    return () => {
      map.un('pointermove', handler as unknown as () => void);
      map.un('moveend', handler);
    };
  }, [map, selectedFeatureIds]);

  useEffect(() => {
    refreshEditControlsPos();
  }, [selectedFeatureIds, refreshEditControlsPos]);

  // Reset all selection state (React, store mirror and the rollback snapshots).
  const clearSelection = useCallback(() => {
    sourceRef.current?.clear();
    setSelectedFeatureIds([]);
    setSelectedAnnotationIds([]);
    setEditingId(null);
    setEditControlsPos(null);
    originalGeometriesRef.current = new Map();
  }, [setSelectedAnnotationIds, setEditingId]);

  // Pull one annotation's full-resolution geometry into the edit source and
  // start editing it. The tile layer renders this id transparent (via the
  // editingId style variable) while the editable feature here owns it.
  const beginEditAnnotation = useCallback(
    async (annotationId: number) => {
      const source = sourceRef.current;
      if (!source || campaignId === null) return;
      try {
        const response = await getAnnotationApi({
          path: { campaign_id: campaignId, annotation_id: annotationId },
        });
        const annotation = response.data;
        if (!annotation) return;
        const geoJSON = convertWKTToGeoJSON(annotation.geometry.geometry);
        if (!geoJSON) return;

        source.clear();
        const label = extendedLabels.find((l) => l.id === annotation.label_id);
        const style = styleForLabel(
          label ?? { id: annotation.label_id ?? -1, color: '#3b82f6', geometry_type: 'polygon' }
        );
        const feature = geoJsonFormat.readFeature(
          { type: 'Feature', geometry: geoJSON, properties: {} },
          { featureProjection: 'EPSG:3857' }
        ) as OLFeature<Geometry>;
        feature.set(PROP_ANNOTATION_ID, annotationId);
        feature.set(PROP_LABEL_ID, annotation.label_id);
        feature.setStyle(buildStyle(style, true, false));
        source.addFeature(feature);

        originalGeometriesRef.current = new Map([[annotationId, geoJSON]]);
        setEditingId(annotationId);
        setSelectedAnnotationIds([annotationId]);
        setSelectedFeatureIds([String(annotationId)]);
      } catch (err) {
        handleError(err, 'Failed to open annotation for editing');
      }
    },
    [campaignId, extendedLabels, styleForLabel, setEditingId, setSelectedAnnotationIds]
  );
  const beginEditAnnotationRef = useRef(beginEditAnnotation);
  beginEditAnnotationRef.current = beginEditAnnotation;

  // 3. Manage interactions based on activeTool
  const removeAllInteractions = useCallback(() => {
    [
      drawInteractionRef,
      modifyInteractionRef,
      translateInteractionRef,
      snapInteractionRef,
      dragBoxInteractionRef,
    ].forEach((ref) => {
      if (ref.current) {
        map.removeInteraction(ref.current);
        ref.current = null;
      }
    });
    clearSelection();
    map.getTargetElement()?.style.setProperty('cursor', '');
  }, [map, clearSelection]);

  // 3a. Draw interaction (annotate mode)
  const setupDrawInteraction = useCallback(() => {
    const source = sourceRef.current;
    if (!source || !selectedLabel) return;

    const drawStyle = buildDrawStyle(styleForLabel(selectedLabel));

    const olDrawType =
      selectedLabel.geometry_type === 'point'
        ? 'Point'
        : selectedLabel.geometry_type === 'line'
          ? 'LineString'
          : 'Polygon';

    const draw = new Draw({ source, type: olDrawType, style: drawStyle });

    draw.on('drawstart', () => {
      isDrawingRef.current = true;
    });

    draw.on('drawend', async (evt: DrawEvent) => {
      isDrawingRef.current = false;
      const feature = evt.feature as OLFeature<Geometry>;

      // Extract GeoJSON geometry (in EPSG:4326)
      const geoJSON = olFeatureToGeoJSONGeometry(feature);
      const label = selectedLabelRef.current;
      if (!geoJSON || !label) {
        source.removeFeature(feature);
        return;
      }

      const formFields = useCampaignStore.getState().campaign?.settings.form_fields ?? [];

      // No custom fields: save now, keeping the sketch painted until the tiles
      // repaint so the handoff has no visible gap.
      if (formFields.length === 0) {
        const saved = await saveAnnotation(geoJSON, label.id, undefined, {});
        if (saved) {
          map.once('rendercomplete', () => {
            try {
              source.removeFeature(feature);
            } catch {
              /* already gone */
            }
          });
        } else {
          source.removeFeature(feature);
        }
        return;
      }

      // With custom fields, defer the save into a draft answered via the catalog;
      // the sketch is dropped and the draft renders from store state instead.
      source.removeFeature(feature);
      const taskStore = useTaskStore.getState();
      if (taskStore.draftGeometry !== null) {
        // Only one draft at a time: close the open one (save if complete, else
        // discard) before starting this one.
        if (missingRequiredFields(formFields, taskStore.formValues).length === 0) {
          const committed = await taskStore.commitDraft();
          if (!committed) return;
        } else {
          taskStore.discardDraft();
        }
      }
      useTaskStore.getState().beginDraft(geoJSON, label.id);
    });

    map.addInteraction(draw);
    drawInteractionRef.current = draw;

    // Snap helps close polygons cleanly
    const snap = new Snap({ source });
    map.addInteraction(snap);
    snapInteractionRef.current = snap;

    map.getTargetElement()?.style.setProperty('cursor', 'crosshair');
  }, [map, selectedLabel, saveAnnotation, styleForLabel]);

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
          await saveAnnotation(
            polygonGeometry,
            selectedLabelRef.current.id,
            undefined,
            useTaskStore.getState().formValues
          );
        }
      } catch (err) {
        handleError(err, 'Magic wand segmentation failed');
      }
    };

    map.on('click', handleClick as unknown as () => void);
    map.getTargetElement()?.style.setProperty('cursor', 'crosshair');

    return () => {
      controller.abort();
      map.un('click', handleClick as unknown as () => void);
      map.getTargetElement()?.style.setProperty('cursor', '');
    };
  }, [map, selectedLabel, saveAnnotation]);

  // 3c. Edit interaction (tile click -> single edit; shift-box -> multi-select)
  const setupEditInteractions = useCallback(() => {
    const source = sourceRef.current;
    if (!source) return;

    // Plain click hit-tests the read-only tile layer; the clicked annotation is
    // fetched at full resolution and opened for vertex/translate editing.
    const handleClick = (evt: { pixel: number[]; originalEvent: MouseEvent }) => {
      if (activeToolRef.current !== 'edit' || evt.originalEvent.shiftKey) return;
      // Clicking inside the feature currently being edited must not cancel it.
      const onEditFeature = map.forEachFeatureAtPixel(evt.pixel, () => true, {
        layerFilter: (l) => l === vectorLayerRef.current,
        hitTolerance: 4,
      });
      if (onEditFeature) return;
      const hit = map.forEachFeatureAtPixel(evt.pixel, (f) => f, {
        layerFilter: (l) => l.get(ANNOTATION_TILE_LAYER_FLAG) === true,
        hitTolerance: 4,
      });
      if (!hit) {
        clearSelection();
        return;
      }
      const id = (hit.getId() ?? hit.get(PROP_ANNOTATION_ID)) as number | undefined;
      if (id != null) void beginEditAnnotationRef.current(id);
    };
    map.on('click', handleClick as unknown as () => void);

    // Shift+drag selects every annotation intersecting the box for bulk delete.
    // Ids come from the backend (geometry never leaves the server); the highlight
    // is drawn by the tile highlight overlay from selectedAnnotationIds.
    const dragBox = new DragBox({ condition: shiftKeyOnly });
    dragBox.on('boxend', async () => {
      if (campaignId === null) return;
      const ext = dragBox.getGeometry().getExtent();
      const [minLon, minLat] = toLonLat([ext[0], ext[1]]);
      const [maxLon, maxLat] = toLonLat([ext[2], ext[3]]);
      const cornerPixel = map.getPixelFromCoordinate([ext[2], ext[3]]);
      try {
        const response = await getAnnotationIdsInBbox({
          path: { campaign_id: campaignId },
          query: { bbox: `${minLon},${minLat},${maxLon},${maxLat}` },
        });
        const ids = response.data ?? [];
        source.clear();
        setEditingId(null);
        originalGeometriesRef.current = new Map();
        setSelectedAnnotationIds(ids);
        setSelectedFeatureIds(ids.map(String));
        setEditControlsPos(
          cornerPixel && ids.length > 0 ? { x: cornerPixel[0] + 10, y: cornerPixel[1] - 5 } : null
        );
      } catch (err) {
        handleError(err, 'Box selection failed');
      }
    });

    // Modify (vertex drag/insert/delete) and Translate (alt-drag) act on the
    // single feature held in the edit source.
    const translate = new Translate({ layers: [vectorLayerRef.current!], condition: altKeyOnly });
    translate.on('translateend', () => refreshEditControlsPosRef.current());
    const modify = new Modify({ source });
    modify.on('modifyend', () => refreshEditControlsPosRef.current());
    const snap = new Snap({ source });

    map.addInteraction(dragBox);
    map.addInteraction(translate);
    map.addInteraction(modify);
    map.addInteraction(snap);

    dragBoxInteractionRef.current = dragBox;
    modifyInteractionRef.current = modify;
    translateInteractionRef.current = translate;
    snapInteractionRef.current = snap;

    // Hover cursor over an existing tile feature or the edit feature.
    const handlePointerMove = (evt: { dragging: boolean; pixel: number[] }) => {
      if (evt.dragging) return;
      const hit = map.forEachFeatureAtPixel(evt.pixel, () => true, {
        layerFilter: (l) =>
          l.get(ANNOTATION_TILE_LAYER_FLAG) === true || l === vectorLayerRef.current,
        hitTolerance: 4,
      });
      map.getTargetElement()?.style.setProperty('cursor', hit ? 'pointer' : '');
    };
    map.on('pointermove', handlePointerMove as unknown as () => void);

    return () => {
      map.un('click', handleClick as unknown as () => void);
      map.un('pointermove', handlePointerMove as unknown as () => void);
    };
  }, [map, campaignId, clearSelection, setEditingId, setSelectedAnnotationIds]);

  // 3d. Timeseries click handler
  const setupTimeseriesInteraction = useCallback(() => {
    const handleClick = (evt: { coordinate: number[] }) => {
      const [lon, lat] = toLonLat(evt.coordinate);
      probeMarkerRef.current = { lat, lon };
      onTimeseriesClickRef.current?.(lat, lon);
    };
    map.on('click', handleClick as unknown as () => void);
    map.getTargetElement()?.style.setProperty('cursor', 'crosshair');

    return () => {
      map.un('click', handleClick as unknown as () => void);
      probeMarkerRef.current = null;
      map.getTargetElement()?.style.setProperty('cursor', '');
    };
  }, [map]);

  // Main effect: tear down & rebuild interactions on mode change
  useEffect(() => {
    removeAllInteractions();
    let cleanup: (() => void) | undefined;

    // The catalog is annotate-only, so leaving the tool must resolve the draft.
    if (activeTool !== 'annotate' && useTaskStore.getState().draftGeometry !== null) {
      void useTaskStore.getState().closeDraft();
    }

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

  // Swallow ESC only while a sketch is being drawn (to abort it); once the
  // geometry is finished ESC belongs to the panel, which closes the draft.
  useEffect(() => {
    if (activeTool !== 'annotate') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isDrawingRef.current) return;
      const draw = drawInteractionRef.current;
      if (!draw) return;
      e.preventDefault();
      e.stopPropagation();
      draw.abortDrawing();
      isDrawingRef.current = false;
    };
    // Capture phase so we beat any window listeners that might also handle ESC
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activeTool]);

  // 4. ESC key: cancel the in-progress edit. The edit feature is discarded and
  // editingId cleared, so the tile layer paints the unedited annotation again.
  useEffect(() => {
    if (selectedFeatureIds.length === 0 || activeTool !== 'edit') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      clearSelection();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFeatureIds, activeTool, clearSelection]);

  // 5. Edit control handlers (confirm / delete)
  const handleConfirmEdit = useCallback(async () => {
    const source = sourceRef.current;
    // Geometry editing is a single-feature operation; the confirm button is only
    // shown when exactly one feature is selected.
    if (!source || selectedFeatureIds.length !== 1) return;

    const feature = source
      .getFeatures()
      .find((f) => String(f.get(PROP_ANNOTATION_ID)) === selectedFeatureIds[0]);

    if (feature) {
      const annotationId = feature.get(PROP_ANNOTATION_ID) as number;
      const geoJSON = olFeatureToGeoJSONGeometry(feature);
      if (geoJSON) {
        // Preserve label/comment - the PUT only changes geometry. Prefer the
        // fetched detail; fall back to the feature's labelId.
        const detail = useAnnotationStore.getState().selectedAnnotationDetail;
        const snap = detail?.form_values ?? {};
        try {
          await updateAnnotationGeometry(annotationId, geoJSON, {
            labelId: detail?.label_id ?? (feature.get(PROP_LABEL_ID) as number | null) ?? null,
            comment: detail?.comment ?? null,
            // Without a loaded detail, or with one that has no stored answers
            // (e.g. a leniently-imported annotation), sending {} would clear
            // required answers - omit instead so the backend keeps them.
            formValues: Object.keys(snap).length ? snap : undefined,
          });
        } catch (err) {
          handleError(err, 'Failed to save geometry update');
        }
      }
    }

    clearSelection();
  }, [selectedFeatureIds, updateAnnotationGeometry, clearSelection]);

  // Delete the current selection. One annotation -> single delete; many ->
  // batch delete. Clears selection first so the edit feature unbinds before the
  // tiles refresh.
  const handleDeleteSelection = useCallback(async () => {
    const ids = selectedFeatureIds.map(Number).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return;

    clearSelection();

    if (ids.length === 1) {
      await deleteAnnotation(ids[0]);
    } else {
      await batchDeleteAnnotations(ids);
    }
  }, [selectedFeatureIds, deleteAnnotation, batchDeleteAnnotations, clearSelection]);

  // 6. Delete / Backspace key: delete the selected annotation(s)
  useEffect(() => {
    if (activeTool !== 'edit' || selectedFeatureIds.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      e.preventDefault();
      void handleDeleteSelection();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTool, selectedFeatureIds, handleDeleteSelection]);

  // Render
  // The map canvas is owned by the parent; we only render the floating edit controls.
  return editControlsPos && selectedFeatureIds.length > 0 && activeTool === 'edit' ? (
    <div
      data-testid="edit-controls"
      data-selected-count={selectedFeatureIds.length}
      className="absolute z-[1000] flex items-center gap-1 pointer-events-none"
      style={{ left: editControlsPos.x, top: editControlsPos.y }}
    >
      {selectedFeatureIds.length > 1 && (
        <span className="pointer-events-none px-1.5 py-0.5 text-[11px] font-semibold leading-none bg-neutral-800 text-white rounded-full shadow-lg">
          {selectedFeatureIds.length}
        </span>
      )}
      {selectedFeatureIds.length === 1 && (
        <button
          onClick={handleConfirmEdit}
          className="pointer-events-auto p-1.5 bg-green-500 text-white rounded-full shadow-lg hover:bg-green-600 transition-all hover:scale-110 cursor-pointer"
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
      )}
      <button
        data-testid="edit-delete-btn"
        onClick={handleDeleteSelection}
        className="pointer-events-auto p-1.5 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 transition-all hover:scale-110 cursor-pointer"
        title={
          selectedFeatureIds.length > 1
            ? `Delete ${selectedFeatureIds.length} annotations (Delete)`
            : 'Delete annotation (Delete)'
        }
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
  ) : null;
};

export default memo(DrawingLayer);
