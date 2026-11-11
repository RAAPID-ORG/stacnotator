import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { SegmentedControl } from '~/shared/ui/SegmentedControl';
import { InfoPopover } from '~/shared/ui/InfoPopover';
import { IconCursor, IconPointProbe, IconPolygon, IconQuestion } from '~/shared/ui/Icons';
import { useWorkStore } from '../stores/work';
import { useDrawsShapes } from '../stores/campaign';

/** Probe geometry as icons, each explained on hover; `help` adds the full how-to
 *  behind a question mark where there is room for it. */
export function ProbeModeControl({ help = false }: { help?: boolean }) {
  const { t } = useTranslation('panels');
  const mode = useWorkStore((s) => s.probeMode);
  const drawsShapes = useDrawsShapes();
  useEffect(() => {
    if (!drawsShapes && mode === 'select') useWorkStore.getState().setProbeMode('point');
  }, [drawsShapes, mode]);
  const iconOnly = (text: string) => <span className="sr-only">{text}</span>;
  return (
    <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
      <SegmentedControl
        aria-label={t('probes.mode')}
        size="icon"
        value={mode}
        onChange={useWorkStore.getState().setProbeMode}
        segments={[
          {
            value: 'point',
            Icon: IconPointProbe,
            label: iconOnly(t('probes.point')),
            title: t('probes.titles.point'),
          },
          {
            value: 'draw',
            Icon: IconPolygon,
            label: iconOnly(t('probes.draw')),
            title: t('probes.titles.draw'),
          },
          ...(drawsShapes
            ? [
                {
                  value: 'select' as const,
                  Icon: IconCursor,
                  label: iconOnly(t('probes.select')),
                  title: t('probes.titles.select'),
                },
              ]
            : []),
        ]}
      />
      {help && <InfoPopover Icon={IconQuestion}>{t('probes.help')}</InfoPopover>}
    </div>
  );
}
