import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
        aria-label="Time series legend explanation"
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
        aria-label="Chart options"
        aria-expanded={optionsOpen}
        title="Chart options"
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
            <p>
              Each dot is one observation. <strong>Colored dots</strong> are clear-day observations
              (one color per series). <strong>Gray dots</strong> are observations flagged as cloudy.
            </p>
            <p>
              <strong>Remove cloudy</strong> drops the gray observations from both the raw series
              and the smoothed line.
            </p>
            <p>
              <strong>Smooth</strong> fits a Savitzky-Golay filter. If you leave cloudy points in,
              the filter pulls the smoothed line toward them - usually Remove cloudy + Smooth
              together is what you want.
            </p>
            <p>
              <strong>Dots</strong> toggles whether the per-observation markers are drawn.
            </p>
          </div>,
          infoBtnRef.current?.ownerDocument.body ?? document.body
        )}
    </div>
  );
}
