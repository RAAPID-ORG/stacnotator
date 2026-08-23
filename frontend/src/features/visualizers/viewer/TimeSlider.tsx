import { useRef } from 'react';
import type { VisualizerStepOut } from '~/api/client';
import { IconChevronLeft, IconChevronRight } from '~/shared/ui/Icons';

/**
 * The date axis. One segment per step, scrubbed by pointer and stepped by the
 * arrow keys, with the current step's own label spelled out above it - the
 * ticks say where you are in the record, the label says what you are seeing.
 */
export function TimeSlider({
  steps,
  index,
  onSelect,
}: {
  steps: VisualizerStepOut[];
  index: number;
  onSelect: (index: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  if (steps.length === 0) return null;

  const pickAt = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = (clientX - rect.left) / rect.width;
    const picked = Math.floor(ratio * steps.length);
    onSelect(Math.min(steps.length - 1, Math.max(0, picked)));
  };

  const step = (delta: number) => onSelect(Math.min(steps.length - 1, Math.max(0, index + delta)));

  const current = steps[index];
  const years = yearMarks(steps);

  return (
    <div
      className="pointer-events-auto w-[min(46rem,calc(100vw-2rem))] rounded-xl border border-white/10 bg-neutral-900/85 px-3 py-2.5 text-white shadow-2xl backdrop-blur"
      data-testid="visualizer-time-slider"
    >
      <div className="flex items-center gap-2">
        <SliderButton label="Previous date" disabled={index === 0} onClick={() => step(-1)}>
          <IconChevronLeft className="h-4 w-4" />
        </SliderButton>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span
              className="truncate text-sm font-medium tabular-nums"
              data-testid="visualizer-step-label"
            >
              {current?.label}
            </span>
            <span className="shrink-0 text-[11px] text-white/40 tabular-nums">
              {index + 1} / {steps.length}
            </span>
          </div>

          <div
            ref={track}
            role="slider"
            tabIndex={0}
            aria-label="Date"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={index + 1}
            aria-valuetext={current?.label}
            onPointerDown={(e) => {
              if (e.pointerType === 'mouse' && e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              pickAt(e.clientX);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) pickAt(e.clientX);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') step(-1);
              else if (e.key === 'ArrowRight') step(1);
              else return;
              e.preventDefault();
            }}
            className="group relative mt-1.5 h-6 cursor-pointer touch-none select-none"
          >
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/15" />
            <div
              className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-brand-500"
              style={{ width: `${((index + 0.5) / steps.length) * 100}%` }}
            />
            {steps.map((s, i) => (
              <span
                key={s.slice_id}
                title={s.label}
                className={`absolute top-1/2 h-2 w-px -translate-y-1/2 ${
                  i === index ? 'bg-transparent' : 'bg-white/25'
                }`}
                style={{ left: `${((i + 0.5) / steps.length) * 100}%` }}
              />
            ))}
            <span
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-neutral-900 bg-white shadow transition-transform group-hover:scale-110"
              style={{ left: `${((index + 0.5) / steps.length) * 100}%` }}
            />
          </div>

          {years.length > 1 && (
            <div className="relative mt-0.5 h-3">
              {years.map((mark) => (
                <span
                  key={mark.year}
                  className="absolute -translate-x-1/2 text-[10px] text-white/35 tabular-nums"
                  style={{ left: `${mark.ratio * 100}%` }}
                >
                  {mark.year}
                </span>
              ))}
            </div>
          )}
        </div>

        <SliderButton
          label="Next date"
          disabled={index === steps.length - 1}
          onClick={() => step(1)}
        >
          <IconChevronRight className="h-4 w-4" />
        </SliderButton>
      </div>
    </div>
  );
}

function SliderButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="shrink-0 cursor-pointer rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** One label per year the record spans, placed over its first step. */
function yearMarks(steps: VisualizerStepOut[]): Array<{ year: string; ratio: number }> {
  const marks: Array<{ year: string; ratio: number }> = [];
  steps.forEach((step, index) => {
    const year = step.start_date.slice(0, 4);
    if (marks.some((mark) => mark.year === year)) return;
    marks.push({ year, ratio: (index + 0.5) / steps.length });
  });
  return marks;
}
