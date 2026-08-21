import { IconCheck } from '~/shared/ui/Icons';

interface StepIndicatorProps {
  /** Step labels, in order. */
  steps: readonly string[];
  /** The step being shown, 1-based. */
  step: number;
  /** Omit to make the trail read-only. Only finished steps can be jumped to. */
  onStepClick?: (step: number) => void;
  /** Parallel to `steps`: marks one that still needs attention. */
  warnings?: readonly boolean[];
}

/** The trail every multi-step flow in this app is walked with. */
export const StepIndicator = ({ steps, step, onStepClick, warnings }: StepIndicatorProps) => (
  <div className="flex items-center justify-center gap-1 sm:gap-2 flex-wrap">
    {steps.map((label, i) => {
      const index = i + 1;
      const active = step === index;
      const done = step > index;
      const clickable = onStepClick && (done || active);
      const warn = done && warnings?.[i];

      return (
        <div key={label} className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => clickable && onStepClick(index)}
            disabled={!clickable}
            className={`flex items-center gap-1.5 sm:gap-2.5 ${
              clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
            } transition-opacity`}
          >
            <span
              className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                warn
                  ? 'bg-amber-100 text-amber-800'
                  : done
                    ? 'bg-brand-600 text-white'
                    : active
                      ? 'bg-brand-50 text-brand-700 ring-2 ring-brand-600'
                      : 'bg-neutral-100 text-neutral-400'
              }`}
            >
              {warn ? '!' : done ? <IconCheck className="w-3.5 h-3.5" /> : index}
            </span>
            <span
              className={`text-sm whitespace-nowrap hidden md:inline ${
                active
                  ? 'text-brand-700 font-semibold'
                  : done
                    ? 'text-neutral-700 font-medium'
                    : 'text-neutral-400'
              }`}
            >
              {label}
            </span>
            {/* On narrow screens only show the active step's label */}
            {active && (
              <span className="text-sm whitespace-nowrap md:hidden text-brand-700 font-semibold">
                {label}
              </span>
            )}
          </button>

          {i < steps.length - 1 && (
            <span
              className={`h-px w-3 sm:w-6 md:w-8 shrink-0 ${
                done ? 'bg-brand-400' : 'bg-neutral-200'
              }`}
            />
          )}
        </div>
      );
    })}
  </div>
);
