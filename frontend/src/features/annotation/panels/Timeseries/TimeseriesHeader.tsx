import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trans, useTranslation } from 'react-i18next';
import { IconInfo, IconSliders } from '~/shared/ui/Icons';
import { useDismissOnOutside } from '~/shared/hooks/useDismissOnOutside';
import { usePrefsStore } from '../../stores/prefs';
import { OptionsPopover } from './TimeseriesOptions';

/**
 * The chart's own controls, in the panel header rather than above the plot.
 *
 * They act on the whole window and never change with the data, so the chart
 * body is left to the legend and the plot - which is what the header is for.
 * Options are global preferences, so this owns them directly instead of
 * reaching into the chart.
 */
export function TimeseriesHeader() {
  const { t } = useTranslation('panels');
  const { removeCloudy, showDots, smoothEnabled, smoothing } = usePrefsStore(
    (s) => s.timeseriesChart
  );
  const setChartOptions = usePrefsStore((s) => s.setTimeseriesChart);

  const [infoOpen, setInfoOpen] = useState(false);
  const [infoPos, setInfoPos] = useState<{ top: number; left: number } | null>(null);
  const infoBtnRef = useRef<HTMLButtonElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsBtnRef = useRef<HTMLButtonElement>(null);
  const optionsPanelRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([optionsBtnRef, optionsPanelRef], () => setOptionsOpen(false), optionsOpen);

  const showInfo = () => {
    const rect = infoBtnRef.current?.getBoundingClientRect();
    if (rect) setInfoPos({ top: rect.bottom + 4, left: rect.left });
    setInfoOpen(true);
  };

  return (
    <div className="relative flex items-center gap-0.5">
      <button
        ref={infoBtnRef}
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-5 w-5 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
        aria-label={t('timeseries.legendInfo')}
        onMouseEnter={showInfo}
        onMouseLeave={() => setInfoOpen(false)}
        onFocus={showInfo}
        onBlur={() => setInfoOpen(false)}
      >
        <IconInfo className="h-3 w-3" />
      </button>

      <button
        ref={optionsBtnRef}
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex h-5 w-5 items-center justify-center rounded-md transition-colors cursor-pointer ${
          optionsOpen
            ? 'bg-neutral-100 text-neutral-700'
            : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700'
        }`}
        aria-label={t('timeseries.chartOptions')}
        aria-expanded={optionsOpen}
        title={t('timeseries.chartOptions')}
        onClick={() => setOptionsOpen((open) => !open)}
      >
        <IconSliders className="h-3.5 w-3.5" />
      </button>

      {optionsOpen && (
        <OptionsPopover
          ref={optionsPanelRef}
          removeCloudy={removeCloudy}
          onRemoveCloudyChange={(removeCloudy) => setChartOptions({ removeCloudy })}
          smoothEnabled={smoothEnabled}
          onSmoothEnabledChange={(smoothEnabled) => setChartOptions({ smoothEnabled })}
          smoothing={smoothing}
          onSmoothingChange={(smoothing) => setChartOptions({ smoothing })}
          showDots={showDots}
          onShowDotsChange={(showDots) => setChartOptions({ showDots })}
        />
      )}

      {infoOpen &&
        infoPos &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[10000] w-72 space-y-1.5 rounded-md bg-neutral-800 px-3 py-2 text-[11px] leading-relaxed text-white shadow-lg"
            style={{
              top: infoPos.top,
              left: Math.min(
                infoPos.left,
                (infoBtnRef.current?.ownerDocument.defaultView ?? window).innerWidth - 296
              ),
            }}
          >
            {(['dots', 'removeCloudy', 'smooth', 'showDots'] as const).map((key) => (
              <p key={key}>
                <Trans
                  t={t}
                  i18nKey={`timeseries.info.${key}`}
                  components={{ strong: <strong /> }}
                />
              </p>
            ))}
          </div>,
          infoBtnRef.current?.ownerDocument.body ?? document.body
        )}
    </div>
  );
}
