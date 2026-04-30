import { useEffect } from 'react';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';
import { useAnnotationStore } from '../stores/annotation.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { extendLabelsWithMetadata } from '../components/ControlsOpenMode';

/**
 * Keyboard shortcuts for open mode annotation.
 *
 * Tool switching:
 *   V - Pan
 *   R - Annotate (draw)
 *   E - Edit
 *   T - Timeseries (only when campaign has time series)
 *
 * Label selection:
 *   1-9 - Select label by index and switch to Annotate
 *
 * Misc:
 *   Escape - Handled by DrawingLayer (cancel edit / rollback)
 */
export const useOpenModeKeyboard = () => {
  const campaign = useCampaignStore((s) => s.campaign);
  const selectedViewId = useCampaignStore((s) => s.selectedViewId);
  const setSelectedLabelId = useTaskStore((s) => s.setSelectedLabelId);
  const setActiveTool = useMapStore((s) => s.setActiveTool);
  const setTimeseriesPoint = useMapStore((s) => s.setTimeseriesPoint);
  const triggerFitAnnotations = useMapStore((s) => s.triggerFitAnnotations);
  const toggleViewSync = useMapStore((s) => s.toggleViewSync);
  const goToPreviousAnnotation = useAnnotationStore((s) => s.goToPreviousAnnotation);
  const goToNextAnnotation = useAnnotationStore((s) => s.goToNextAnnotation);
  const toggleGuide = useLayoutStore((s) => s.toggleGuide);

  useEffect(() => {
    if (!campaign || campaign.mode !== 'open') return;

    const labels = campaign.settings.labels;
    const extendedLabels = extendLabelsWithMetadata(labels);
    const hasTimeseries = (campaign.time_series?.length ?? 0) > 0;

    const view = campaign.imagery_views?.find((v) => v.id === selectedViewId);
    const viewSourceIds = new Set((view?.collection_refs ?? []).map((r) => r.source_id));
    const sourceGroups: { id: number; startIdx: number; count: number }[] = [];
    let offset = 0;
    for (const src of campaign.imagery_sources) {
      if (viewSourceIds.size > 0 && !viewSourceIds.has(src.id)) {
        offset += src.visualizations.length;
        continue;
      }
      sourceGroups.push({ id: src.id, startIdx: offset, count: src.visualizations.length });
      offset += src.visualizations.length;
    }
    const basemapIds = (campaign.basemaps ?? []).map((b) => `basemap-${b.id}`);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Number keys 1-9: select label and switch to annotate
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        if (index < extendedLabels.length) {
          setSelectedLabelId(extendedLabels[index].id);
          setActiveTool('annotate');
        }
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'v':
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
        case 'l':
          e.preventDefault();
          toggleViewSync();
          break;
        case 'i': {
          e.preventDefault();
          const mapState = useMapStore.getState();
          const currentIdx = mapState.selectedLayerIndex;
          const isBasemap = mapState.showBasemap;

          if (e.shiftKey) {
            // Shift+I: cycle visualizations within the active source
            if (isBasemap || sourceGroups.length === 0 || !campaign) break;
            const activeColId = mapState.activeCollectionId;
            const activeSrc = campaign.imagery_sources.find((s) =>
              s.collections.some((c) => c.id === activeColId)
            );
            if (!activeSrc) break;
            const activeGroup = sourceGroups.find((g) => g.id === activeSrc.id);
            if (!activeGroup || activeGroup.count <= 1) break;
            const posInGroup = Math.min(
              Math.max(0, currentIdx - activeGroup.startIdx),
              activeGroup.count - 1
            );
            const nextPos = (posInGroup + 1) % activeGroup.count;
            useMapStore.getState().setSelectedLayerIndex(activeGroup.startIdx + nextPos);
          } else {
            const map = useMapStore.getState();
            const totalEntries = sourceGroups.length + basemapIds.length;
            if (totalEntries <= 1) break;

            const sources = campaign.imagery_sources;
            const selectedView = campaign.imagery_views?.find((v) => v.id === selectedViewId);
            if (!selectedView) break;

            const layerIdx = map.selectedLayerIndex;
            const colId = map.activeCollectionId;
            const onBasemap = map.showBasemap;

            let currentEntryIdx: number;
            if (onBasemap) {
              const bmIdx = basemapIds.indexOf(map.selectedBasemapId ?? '');
              currentEntryIdx = sourceGroups.length + Math.max(0, bmIdx);
            } else {
              const srcByCollection = sources.find((s) =>
                s.collections.some((c) => c.id === colId)
              );
              currentEntryIdx = srcByCollection
                ? sourceGroups.findIndex((g) => g.id === srcByCollection.id)
                : sourceGroups.findIndex(
                    (g) => layerIdx >= g.startIdx && layerIdx < g.startIdx + g.count
                  );
              if (currentEntryIdx === -1) currentEntryIdx = 0;
            }

            if (!onBasemap && colId !== null) {
              const currentSrc = sources.find((s) => s.collections.some((c) => c.id === colId));
              if (currentSrc) map.recordSourceState(currentSrc.id, colId, layerIdx);
            }

            const nextEntryIdx = (currentEntryIdx + 1) % totalEntries;

            if (nextEntryIdx >= sourceGroups.length) {
              const bmIdx = nextEntryIdx - sourceGroups.length;
              map.setShowBasemap(true);
              map.setSelectedBasemapId(basemapIds[bmIdx]);
              break;
            }

            const group = sourceGroups[nextEntryIdx];
            const targetSource = sources.find((s) => s.id === group.id);
            if (!targetSource) break;

            map.setSelectedLayerIndex(group.startIdx);

            const remembered = map.lastSourceState[targetSource.id];
            const canRestore =
              remembered &&
              targetSource.collections.some((c) => c.id === remembered.collectionId) &&
              selectedView.collection_refs.some((r) => r.collection_id === remembered.collectionId);

            const targetCollectionId = canRestore
              ? remembered.collectionId
              : selectedView.collection_refs.find((r) => r.source_id === targetSource.id)
                  ?.collection_id;
            if (targetCollectionId !== undefined) map.setActiveCollectionId(targetCollectionId);
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
        case 'w':
          e.preventDefault();
          goToPreviousAnnotation();
          triggerFitAnnotations();
          break;
        case 's':
          e.preventDefault();
          goToNextAnnotation();
          triggerFitAnnotations();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    campaign,
    selectedViewId,
    setSelectedLabelId,
    setActiveTool,
    setTimeseriesPoint,
    triggerFitAnnotations,
    toggleViewSync,
    goToPreviousAnnotation,
    goToNextAnnotation,
    toggleGuide,
  ]);
};
