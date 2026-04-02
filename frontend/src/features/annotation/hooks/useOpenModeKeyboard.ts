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

    // Pre-compute source → viz index ranges for I / Shift+I cycling
    const _allVizEntries = campaign.imagery_sources.flatMap((src) =>
      src.visualizations.map((v) => ({ sourceName: src.name, vizName: v.name }))
    );
    // Build unique source groups with their start/end indices into allVizEntries
    const sourceGroups: { name: string; startIdx: number; count: number }[] = [];
    let offset = 0;
    for (const src of campaign.imagery_sources) {
      sourceGroups.push({ name: src.name, startIdx: offset, count: src.visualizations.length });
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
            // Shift+I: cycle visualizations within current source
            if (isBasemap || sourceGroups.length === 0) break; // no viz cycling when on basemap
            const currentGroup = sourceGroups.find(
              (g) => currentIdx >= g.startIdx && currentIdx < g.startIdx + g.count
            );
            if (!currentGroup || currentGroup.count <= 1) break;
            const posInGroup = currentIdx - currentGroup.startIdx;
            const nextPos = (posInGroup + 1) % currentGroup.count;
            useMapStore.getState().setSelectedLayerIndex(currentGroup.startIdx + nextPos);
          } else {
            // I: cycle through imagery sources + individual basemaps
            const mapState2 = useMapStore.getState();
            const totalEntries = sourceGroups.length + basemapIds.length;
            if (totalEntries <= 1) break;

            let currentEntryIdx: number;
            if (isBasemap) {
              const bmIdx = basemapIds.indexOf(mapState2.selectedBasemapId ?? '');
              currentEntryIdx = sourceGroups.length + (bmIdx >= 0 ? bmIdx : 0);
            } else {
              currentEntryIdx = sourceGroups.findIndex(
                (g) => currentIdx >= g.startIdx && currentIdx < g.startIdx + g.count
              );
              if (currentEntryIdx === -1) currentEntryIdx = 0;
            }

            const nextEntryIdx = (currentEntryIdx + 1) % totalEntries;

            if (nextEntryIdx < sourceGroups.length) {
              // Switch to an imagery source (first viz)
              const group = sourceGroups[nextEntryIdx];
              useMapStore.getState().setSelectedLayerIndex(group.startIdx);
              // setSelectedLayerIndex already sets showBasemap=false
            } else {
              // Switch to a specific basemap
              const bmIdx = nextEntryIdx - sourceGroups.length;
              useMapStore.getState().setShowBasemap(true);
              useMapStore.getState().setSelectedBasemapId(basemapIds[bmIdx]);
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
