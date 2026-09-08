import { useEffect, useRef, useState } from 'react';
import { Button } from '~/shared/ui/forms';
import { Spinner } from '~/shared/ui/Spinner';
import { StepIndicator } from '~/shared/ui/StepIndicator';
import type { AreaEstimationPlan } from '../core/plan';
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
import { formatCount } from './format';

interface Props {
  campaignId: number;
  plan: AreaEstimationPlan;
  update: (patch: Partial<AreaEstimationPlan>) => void;
  onActivate: () => void;
  activating: boolean;
  onCancel?: () => void;
}

export const PlanWizard = ({
  campaignId,
  plan,
  update,
  onActivate,
  activating,
  onCancel,
}: Props) => {
  const [stepIndex, setStepIndex] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  const step = PLAN_STEPS[stepIndex].id;
  const issues = validatePlan(plan);
  const stepIssues = issuesForStep(issues, step);
  const isLast = stepIndex === PLAN_STEPS.length - 1;

  // A step change lands the reader at the start of the new step, not partway
  // down it because the last one was longer. Deliberately not
  // scrollIntoView: that scrolls every scrollable ancestor including the
  // document, which drags the whole app shell out of place.
  useEffect(() => {
    scrollableParent(top.current)?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [stepIndex]);

  // Entering the classes step with nothing defined, the obvious starting point
  // is the map's own classes; merging is then an edit rather than a blank page.
  useEffect(() => {
    if (step === 'classes' && plan.classes.length === 0 && plan.values.length > 0) {
      update({ classes: oneClassPerValue(plan) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  return (
    <div className="space-y-6" ref={top}>
      <StepIndicator
        steps={PLAN_STEPS.map((s) => s.name)}
        step={stepIndex + 1}
        onStepClick={(n) => setStepIndex(n - 1)}
        warnings={PLAN_STEPS.map((s) => issuesForStep(issues, s.id).length > 0)}
      />

      <div className="space-y-6">
        {step === 'data' && <StepData campaignId={campaignId} plan={plan} update={update} />}
        {step === 'classes' && <StepClasses plan={plan} update={update} />}
        {step === 'prior' && <StepPrior plan={plan} update={update} />}
        {step === 'design' && <StepDesign plan={plan} update={update} />}

        {stepIssues.length > 0 && (
          <ul className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-1">
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
              Draw {formatCount(totalPoints(designsOf(plan)))} sampling units
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

/** The one box the wizard sits in, so scrolling it leaves the app shell alone. */
const scrollableParent = (from: HTMLElement | null): HTMLElement | null => {
  for (let node = from?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
};
