import { useEffect } from 'react';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';
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

  useEffect(() => {
    if (!campaign || campaign.mode !== 'open') return;

    const labels = campaign.settings.labels;
    const extendedLabels = extendLabelsWithMetadata(labels);
    const hasTimeseries = (campaign.time_series?.length ?? 0) > 0;

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
        case ' ':
          e.preventDefault();
          triggerFitAnnotations();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [campaign, setSelectedLabelId, setActiveTool, setTimeseriesPoint, triggerFitAnnotations]);
};
