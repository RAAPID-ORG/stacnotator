import { STEP_CONFIG } from './CreateCampaignModal';

export const StepIndicator = ({ step, mode = 'tasks' }: { step: number; mode?: 'tasks' | 'open' }) => {
  const STEPS = STEP_CONFIG[mode].map(s => s.name);
  return (
    <div className="px-6 pt-4">
      <div
        className="grid items-center"
        style={{
          gridTemplateColumns: `repeat(${STEPS.length * 2 - 1}, minmax(0, 1fr))`,
        }}
      >
        {STEPS.map((label, i) => {
          const index = i + 1;
          const active = step === index;
          const done = step > index;

          return (
            <div
              key={label}
              className="col-span-1 flex flex-col items-center"
            >
              <div
                className={`
                  h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium
                  ${done && 'bg-brand-500 text-white'}
                  ${active && 'bg-neutral-100 text-neutral-900 ring-2 ring-brand-500'}
                  ${!done && !active && 'bg-neutral-100 text-neutral-500'}
                `}
              >
                {done ? '✓' : index}
              </div>

              <span
                className={`mt-2 text-xs text-center
                  ${active ? 'text-neutral-700 font-medium' : 'text-neutral-500'}
                `}
              >
                {label}
              </span>
            </div>
          );
        }).flatMap((stepEl, i) =>
          i < STEPS.length - 1
            ? [
                stepEl,
                <div
                  key={`line-${i}`}
                  className={`col-span-1 h-px self-center
                    ${step > i + 1 ? 'bg-brand-500' : 'bg-neutral-200'}
                  `}
                />,
              ]
            : [stepEl]
        )}
      </div>
    </div>
  );
};
