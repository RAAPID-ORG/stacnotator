import { useEffect, useState } from 'react';
import { Button } from '~/shared/ui/forms';
import { Spinner } from '~/shared/ui/Spinner';
import type { AreaEstimationPlan, PlanStep, StepIssue } from '../core/plan';
import {
  PLAN_STEPS,
  designsOf,
  issuesForStep,
  oneClassPerValue,
  totalPoints,
  validatePlan,
} from '../core/plan';
import { StepClasses } from './StepClasses';
import { StepData } from './StepData';
import { StepDesign } from './StepDesign';
import { StepPrior } from './StepPrior';
import { StepTarget } from './StepTarget';
import { formatCount } from './format';

interface Props {
  plan: AreaEstimationPlan;
  update: (patch: Partial<AreaEstimationPlan>) => void;
  onActivate: () => void;
  activating: boolean;
  onCancel?: () => void;
}

export const PlanWizard = ({ plan, update, onActivate, activating, onCancel }: Props) => {
  const [stepIndex, setStepIndex] = useState(0);
  const step = PLAN_STEPS[stepIndex].id;
  const issues = validatePlan(plan);
  const stepIssues = issuesForStep(issues, step);
  const isLast = stepIndex === PLAN_STEPS.length - 1;

  // Entering the classes step with nothing defined, the obvious starting point
  // is the map's own classes; merging is then an edit rather than a blank page.
  useEffect(() => {
    if (step === 'classes' && plan.classes.length === 0 && plan.values.length > 0) {
      update({ classes: oneClassPerValue(plan) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  return (
    <div className="space-y-6">
      <WizardSteps current={stepIndex} issues={issues} onSelect={setStepIndex} />

      <div className="border border-neutral-200 rounded-xl p-6 bg-white">
        {step === 'data' && <StepData plan={plan} update={update} />}
        {step === 'classes' && <StepClasses plan={plan} update={update} />}
        {step === 'target' && <StepTarget plan={plan} update={update} />}
        {step === 'prior' && <StepPrior plan={plan} update={update} />}
        {step === 'design' && <StepDesign plan={plan} update={update} />}

        {stepIssues.length > 0 && (
          <ul className="mt-6 border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-1">
            {stepIssues.map((issue) => (
              <li key={issue.message} className="text-xs text-amber-900 leading-snug">
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          onClick={() => (stepIndex === 0 ? onCancel?.() : setStepIndex(stepIndex - 1))}
          disabled={stepIndex === 0 && !onCancel}
        >
          {stepIndex === 0 ? 'Cancel' : 'Back'}
        </Button>

        {isLast ? (
          <div className="flex items-center gap-3">
            {issues.length > 0 && (
              <span className="text-xs text-neutral-500">
                {issues.length} thing{issues.length === 1 ? '' : 's'} still to fix
              </span>
            )}
            <Button
              onClick={onActivate}
              disabled={issues.length > 0 || activating}
              leading={activating ? <Spinner size="xs" variant="white" /> : undefined}
              data-testid="uae-activate"
            >
              Draw {formatCount(totalPoints(designsOf(plan)))} sample points
            </Button>
          </div>
        ) : (
          <Button onClick={() => setStepIndex(stepIndex + 1)} data-testid="uae-continue">
            Continue
          </Button>
        )}
      </div>
    </div>
  );
};

const WizardSteps = ({
  current,
  issues,
  onSelect,
}: {
  current: number;
  issues: readonly StepIssue[];
  onSelect: (index: number) => void;
}) => (
  <ol className="flex items-center gap-1 flex-wrap">
    {PLAN_STEPS.map((step, index) => {
      const active = index === current;
      const done = index < current;
      const blocked = done && hasIssue(issues, step.id);
      return (
        <li key={step.id} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onSelect(index)}
            aria-current={active ? 'step' : undefined}
            className={`flex items-center gap-2 h-8 pl-1.5 pr-3 rounded-full transition-colors cursor-pointer ${
              active ? 'bg-brand-50 text-brand-700' : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                blocked
                  ? 'bg-amber-100 text-amber-800'
                  : done
                    ? 'bg-brand-600 text-white'
                    : active
                      ? 'bg-white text-brand-700 ring-2 ring-brand-600'
                      : 'bg-neutral-100 text-neutral-400'
              }`}
            >
              {blocked ? '!' : index + 1}
            </span>
            <span className="text-xs font-medium whitespace-nowrap">{step.name}</span>
          </button>
          {index < PLAN_STEPS.length - 1 && <span className="h-px w-4 bg-neutral-200" />}
        </li>
      );
    })}
  </ol>
);

const hasIssue = (issues: readonly StepIssue[], step: PlanStep) =>
  issues.some((i) => i.step === step);
