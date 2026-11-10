import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { SegmentedControl } from '~/shared/ui/SegmentedControl';
import { useWorkStore } from '../stores/work';
import { useDrawsShapes } from '../stores/campaign';

export function ProbeModeControl() {
  const { t } = useTranslation('panels');
  const mode = useWorkStore((s) => s.probeMode);
  const drawsShapes = useDrawsShapes();
  useEffect(() => {
    if (!drawsShapes && mode === 'select') useWorkStore.getState().setProbeMode('point');
  }, [drawsShapes, mode]);
  return (
    <div className="max-w-full overflow-x-auto" onMouseDown={(e) => e.stopPropagation()}>
      <SegmentedControl
        aria-label={t('probes.mode')}
        size="bar"
        value={mode}
        onChange={useWorkStore.getState().setProbeMode}
        segments={[
          { value: 'point', label: t('probes.point') },
          { value: 'draw', label: t('probes.draw') },
          ...(drawsShapes ? [{ value: 'select' as const, label: t('probes.select') }] : []),
        ]}
      />
    </div>
  );
}
