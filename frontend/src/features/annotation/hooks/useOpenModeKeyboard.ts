import { useEffect } from 'react';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';
import { useAnnotationStore } from '../stores/annotation.store';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { extendLabelsWithMetadata } from '../utils/labelMetadata';
import { toggleCustomMap, cycleCustomMap } from '~/features/customLayers/utils/customMapNav';
import { toggleVectorLayer, cycleVectorLayer } from '~/features/customLayers/utils/vectorLayerNav';
import { handleFormFieldKey } from '../utils/formFieldNav';
import { viewSources } from '../utils/viewCollections';
import {
  buildSourceGroups,
  computeCycleSource,
  computeCycleVisualization,
} from '../utils/imagerySourceCycling';

/**
 * Keyboard shortcuts for open mode annotation.
 *
 * Tool switching:
 *   P - Pan
 *   R - Annotate (draw)
 *   E - Edit
 *   T - Timeseries (only when campaign has time series)
 *   B - Label vector (only when campaign has vector layers)
 *
 * Label selection:
 *   1-9 - Select label by index and switch to Annotate (only while no
 *         custom form field is active - see form field navigation below)
 *
 * Form field navigation (shared activeFieldIndex/formValues with task mode):
 *   Tab / Shift+Tab - Cycle the label selector, then each custom form field
 *   1-9 - With a category/multicategory field active, toggle that option
 *   Enter / any digit - With a number/text/date/daterange field active, focus its input
 *   Escape - Clear the active field (also handled by DrawingLayer for edit/draw cancel)
 *
 * Misc:
 *   X - Toggle crosshair (shared binding in useAnnotationKeyboard; Shift+X
 *       toggles visibility of drawn objects)
 *   O - Toggle overlay map (Shift+O cycles overlays)
 *   V - Toggle the active vector layer (Shift+V cycles vector layers)
 */
export const useOpenModeKeyboard = () => {
  const campaign = useCampaignStore((s) => s.campaign);
  const workMode = useCampaignStore((s) => s.workMode);
  const selectedViewId = useCampaignStore((s) => s.selectedViewId);
  const setSelectedLabelId = useTaskStore((s) => s.setSelectedLabelId);
  const formValues = useTaskStore((s) => s.formValues);
  const activeFieldIndex = useTaskStore((s) => s.activeFieldIndex);
  const setFormValues = useTaskStore((s) => s.setFormValues);
  const setActiveFieldIndex = useTaskStore((s) => s.setActiveFieldIndex);
  const setActiveTool = useMapStore((s) => s.setActiveTool);
  const setTimeseriesPoint = useMapStore((s) => s.setTimeseriesPoint);
  const triggerFitAnnotations = useMapStore((s) => s.triggerFitAnnotations);
  const toggleViewSync = useMapStore((s) => s.toggleViewSync);
  const toggleGuide = useLayoutStore((s) => s.toggleGuide);

  useEffect(() => {
    if (!campaign || workMode !== 'explore') return;

    const labels = campaign.settings.labels;
    const extendedLabels = extendLabelsWithMetadata(labels);
    const hasTimeseries = campaign.time_series.length > 0;
    const hasVectorLayers = (campaign.vector_layers?.length ?? 0) > 0;
    const formFields = campaign.settings.form_fields ?? [];

    const view = campaign.imagery_views.find((v) => v.id === selectedViewId);
    const viewSourceIds = new Set(viewSources(campaign.imagery_sources, view).map((s) => s.id));
    const sourceGroups = buildSourceGroups(campaign.imagery_sources, viewSourceIds);
    const basemapIds = campaign.basemaps.map((b) => `basemap-${b.id}`);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Browser shortcuts (Ctrl/Cmd+R reload, Ctrl+P print, ...) must keep their default.
      if (e.ctrlKey || e.metaKey) return;
      // Ignore if user is typing in an input/textarea, except Escape which
      // blurs back to hotkey mode (matches useAnnotationKeyboard's guard).
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        }
        return;
      }

      const draftOpen = useTaskStore.getState().draftGeometry !== null;

      // Enter saves and Esc closes the draft ahead of field navigation, so a
      // pre-selected field does not swallow the first keypress.
      if (draftOpen) {
        if (e.key === 'Enter') {
          e.preventDefault();
          void useTaskStore.getState().commitDraft();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          void useTaskStore.getState().closeDraft();
          return;
        }
      }

      if (
        handleFormFieldKey(e, {
          fields: draftOpen ? formFields : [],
          activeIndex: activeFieldIndex,
          values: formValues,
          setValues: setFormValues,
          setActiveIndex: setActiveFieldIndex,
        })
      ) {
        return;
      }

      if (draftOpen && /^[1-9]$/.test(e.key)) return;

      // 1-9: select label. In label-vector mode keep that tool so the
      // label applies to clicked features; otherwise switch to annotate (draw).
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        if (index < extendedLabels.length) {
          setSelectedLabelId(extendedLabels[index].id);
          if (useMapStore.getState().activeTool !== 'labelvector') {
            setActiveTool('annotate');
          }
        }
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'p':
          e.preventDefault();
          setActiveTool('pan');
          setTimeseriesPoint(null);
          break;
        case 'r':
          e.preventDefault();
          setActiveTool('annotate');
          setTimeseriesPoint(null);
          break;
        case 'e':
          e.preventDefault();
          setActiveTool('edit');
          setTimeseriesPoint(null);
          break;
        case 't':
          if (!hasTimeseries) break;
          e.preventDefault();
          setActiveTool('timeseries');
          break;
        case 'b':
          if (!hasVectorLayers) break;
          e.preventDefault();
          setActiveTool('labelvector');
          setTimeseriesPoint(null);
          break;
        // Shift+X only: plain X (crosshair) is handled by the task-mode hook,
        // whose listener stays active in explore for mode-shared bindings.
        case 'x':
          if (!e.shiftKey) break;
          e.preventDefault();
          useMapStore.getState().toggleAnnotations();
          break;
        case 'l':
          e.preventDefault();
          toggleViewSync();
          break;
        case 'o': {
          e.preventDefault();
          const maps = campaign?.custom_maps ?? [];
          if (e.shiftKey) cycleCustomMap(maps);
          else toggleCustomMap(maps);
          break;
        }
        case 'v': {
          if (!hasVectorLayers) break;
          e.preventDefault();
          const layers = campaign?.vector_layers ?? [];
          if (e.shiftKey) cycleVectorLayer(layers);
          else toggleVectorLayer(layers);
          break;
        }
        case 'i': {
          e.preventDefault();
          const map = useMapStore.getState();

          if (e.shiftKey) {
            // Shift+I: cycle visualizations within the active source
            if (!campaign) break;
            const nextIndex = computeCycleVisualization(
              sourceGroups,
              campaign.imagery_sources,
              map.selectedLayerIndex,
              map.activeCollectionId,
              map.showBasemap
            );
            if (nextIndex !== null) map.setSelectedLayerIndex(nextIndex);
          } else {
            if (!campaign || !view) break;
            const result = computeCycleSource(
              sourceGroups,
              basemapIds,
              campaign.imagery_sources,
              view,
              {
                selectedLayerIndex: map.selectedLayerIndex,
                showBasemap: map.showBasemap,
                activeCollectionId: map.activeCollectionId,
                selectedBasemapId: map.selectedBasemapId,
                lastSourceState: map.lastSourceState,
              }
            );

            if (result.action === 'noop') break;
            if (result.recordState) {
              map.recordSourceState(
                result.recordState.sourceId,
                result.recordState.collectionId,
                result.recordState.layerIndex
              );
            }
            if (result.action === 'switch-to-basemap') {
              map.setShowBasemap(true);
              map.setSelectedBasemapId(result.basemapId);
            } else {
              map.setSelectedLayerIndex(result.layerIndex);
              if (result.collectionId !== undefined) map.setActiveCollectionId(result.collectionId);
            }
          }
          break;
        }
        case ' ':
          e.preventDefault();
          triggerFitAnnotations();
          break;
        case 'g':
          e.preventDefault();
          toggleGuide();
          break;
        case 'f': {
          e.preventDefault();
          const annStore = useAnnotationStore.getState();
          const id = annStore.selectedAnnotationId;
          const ann = annStore.selectedAnnotationDetail;
          if (id == null || !ann) break;
          annStore.updateAnnotationFlags(id, !ann.flagged_for_review, ann.flag_comment);
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    campaign,
    workMode,
    selectedViewId,
    setSelectedLabelId,
    setActiveTool,
    setTimeseriesPoint,
    triggerFitAnnotations,
    toggleViewSync,
    toggleGuide,
    formValues,
    activeFieldIndex,
    setFormValues,
    setActiveFieldIndex,
  ]);
};
