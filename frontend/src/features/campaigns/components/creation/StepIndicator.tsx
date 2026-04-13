export const STEP_CONFIG = {
  tasks: [
    { name: 'Campaign', component: 'StepCampaign' },
    { name: 'Settings', component: 'StepSettings' },
    { name: 'Imagery', component: 'StepImagery' },
    { name: 'Time Series', component: 'StepAddTimeseries' },
    { name: 'Create', component: 'StepReview' },
  ],
  open: [
    { name: 'Campaign', component: 'StepCampaign' },
    { name: 'Settings', component: 'StepSettings' },
    { name: 'Imagery', component: 'StepImagery' },
    { name: 'Time Series', component: 'StepAddTimeseries' },
    { name: 'Create', component: 'StepReview' },
  ],
} as const;

export const StepIndicator = ({
  step,
  mode = 'tasks',
  onStepClick,
}: {
  step: number;
  mode?: 'tasks' | 'open';
  onStepClick?: (step: number) => void;
}) => {
  const STEPS = STEP_CONFIG[mode].map((s) => s.name);
  return (
    <div className="flex items-center justify-center gap-2">
      {STEPS.map((label, i) => {
        const index = i + 1;
        const active = step === index;
        const done = step > index;
        const clickable = onStepClick && (done || active);

        return (
          <div key={label} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => clickable && onStepClick(index)}
              disabled={!clickable}
              className={`flex items-center gap-2.5 ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'} transition-opacity`}
            >
              <div
                className={`
                  h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0
                  ${done ? 'bg-brand-600 text-white' : ''}
                  ${active ? 'bg-brand-50 text-brand-700 ring-2 ring-brand-600' : ''}
                  ${!done && !active ? 'bg-neutral-100 text-neutral-400' : ''}
                `}
              >
                {done ? (
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  index
                )}
              </div>
              <span
                className={`text-sm whitespace-nowrap ${
                  active
                    ? 'text-brand-700 font-semibold'
                    : done
                      ? 'text-neutral-700 font-medium'
                      : 'text-neutral-400'
                }`}
              >
                {label}
              </span>
            </button>

            {i < STEPS.length - 1 && (
              <div
                className={`h-px w-8 shrink-0 ${step > index ? 'bg-brand-400' : 'bg-neutral-200'}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
