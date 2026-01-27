import { useEffect } from 'react';
import { useAnnotationStore } from '~/stores/annotationStore';
import { extendLabelsWithMetadata } from '~/components/annotation/OpenModeControls';

/**
 * Keyboard shortcuts for open mode annotation
 * V = Pan
 * A = Annotate
 * T = Timeseries
 * 1-9 = Select label by index
 * Escape = Deselect label / cancel drawing
 */
export const useOpenModeKeyboard = () => {
  const campaign = useAnnotationStore((state) => state.campaign);
  const selectedLabelId = useAnnotationStore((state) => state.selectedLabelId);
  const setSelectedLabelId = useAnnotationStore((state) => state.setSelectedLabelId);

  useEffect(() => {
    if (!campaign || campaign.mode !== 'open') return;

    const labels = campaign.settings.labels;
    const extendedLabels = extendLabelsWithMetadata(labels);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Number keys 1-9 for label selection
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        if (index < extendedLabels.length) {
          setSelectedLabelId(extendedLabels[index].id);
        }
        return;
      }

      // Escape to deselect label
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedLabelId(null);
        return;
      }

      // Tool shortcuts (v, a, t) are handled by OpenModeControls component state
      // We don't need global shortcuts for tool switching as it's local UI state
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [campaign, setSelectedLabelId]);
};
