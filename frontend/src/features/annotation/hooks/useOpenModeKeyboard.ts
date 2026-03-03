import { useEffect } from 'react';
import useAnnotationStore from '../annotation.store';
import { extendLabelsWithMetadata } from '../components/ControlsOpenMode';

/**
 * Keyboard shortcuts for open mode annotation.
 *
 * Tool switching:
 *   V - Pan
 *   A - Annotate
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
  const campaign = useAnnotationStore((state) => state.campaign);
  const setSelectedLabelId = useAnnotationStore((state) => state.setSelectedLabelId);
  const setActiveTool = useAnnotationStore((state) => state.setActiveTool);
  const setTimeseriesPoint = useAnnotationStore((state) => state.setTimeseriesPoint);
  const triggerFitAnnotations = useAnnotationStore((state) => state.triggerFitAnnotations);

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
        case 'a':
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
