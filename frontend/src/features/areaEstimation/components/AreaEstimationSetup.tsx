import { useCallback, useEffect, useState } from 'react';
import { Badge } from '~/shared/ui/Badge';
import { Button } from '~/shared/ui/forms';
import { Delayed } from '~/shared/ui/Delayed';
import { SkeletonForm } from '~/shared/ui/Skeleton';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import { loadPlan, savePlan } from '../api';
import type { AreaEstimationPlan } from '../core/plan';
import { designsOf, emptyPlan, planNeedsPilot, totalPoints, validatePlan } from '../core/plan';
import { StepHeading } from './Explain';
import { PlanWizard } from './PlanWizard';
import { formatCount, formatPercent } from './format';

interface Props {
  campaignId: number;
  /** The task set this design owns, and whose sample it draws. */
  taskSetId: number;
  taskSetName: string;
}

/**
 * The design attached to one task set. The set exists before the design does,
 * so this never creates one: it edits the plan the set was created with.
 */
export const AreaEstimationSetup = ({ campaignId, taskSetId, taskSetName }: Props) => {
  const [plan, setPlan] = useState<AreaEstimationPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [activating, setActivating] = useState(false);
  const showAlert = useLayoutStore((s) => s.showAlert);

  useEffect(() => {
    let cancelled = false;
    void loadPlan(campaignId, taskSetId).then((stored) => {
      if (cancelled) return;
      const current = stored ?? emptyPlan();
      if (!stored) void savePlan(campaignId, taskSetId, current);
      setPlan(current);
      setEditing(current.activatedAt === null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId, taskSetId]);

  const update = useCallback(
    (patch: Partial<AreaEstimationPlan>) =>
      setPlan((current) => {
        const next = { ...(current ?? emptyPlan()), ...patch };
        void savePlan(campaignId, taskSetId, next);
        return next;
      }),
    [campaignId, taskSetId]
  );

  const activate = () => {
    if (!plan) return;
    setActivating(true);
    try {
      update({ activatedAt: new Date().toISOString() });
      setEditing(false);
      showAlert('The sample design is set. The points will be drawn next.', 'success');
    } catch (err) {
      handleError(err, 'Could not save the sample design');
    } finally {
      setActivating(false);
    }
  };

  if (loading || !plan) {
    return (
      <Delayed>
        <SkeletonForm sections={2} />
      </Delayed>
    );
  }

  return editing ? (
    <PlanWizard
      plan={plan}
      update={update}
      onActivate={activate}
      activating={activating}
      onCancel={plan.activatedAt ? () => setEditing(false) : undefined}
    />
  ) : (
    <ActiveSummary plan={plan} taskSetName={taskSetName} onEdit={() => setEditing(true)} />
  );
};

const ActiveSummary = ({
  plan,
  taskSetName,
  onEdit,
}: {
  plan: AreaEstimationPlan;
  taskSetName: string;
  onEdit: () => void;
}) => {
  const designs = designsOf(plan);
  const issues = validatePlan(plan);
  const pilot = planNeedsPilot(plan);
  const target = plan.classes.find((c) => c.id === plan.targetClassId);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <StepHeading title="Sample design">
          {pilot
            ? 'A pilot sample is running. The full design is proposed once it is annotated.'
            : `Sized for ${target?.name ?? 'the target class'} at ±${formatPercent(plan.targetCv, 0)}.`}
        </StepHeading>
        <div className="flex items-center gap-2 shrink-0">
          <Badge tone={issues.length > 0 ? 'yellow' : 'green'}>
            {issues.length > 0 ? 'Needs attention' : pilot ? 'Pilot' : 'Active'}
          </Badge>
          <Button size="sm" variant="secondary" onClick={onEdit} data-testid="uae-edit-design">
            Edit design
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Sample points" value={formatCount(totalPoints(designs))} />
        <Stat label="Reporting classes" value={String(plan.classes.length)} />
        <Stat
          label="Areas"
          value={
            plan.domainMode === 'per_area'
              ? `${plan.areas.length}, reported separately`
              : `${plan.areas.length}, combined`
          }
        />
        <Stat
          label="Expected precision"
          value={pilot ? '-' : `±${formatPercent(Math.max(...designs.map((d) => d.precision.cv)))}`}
        />
      </dl>

      <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-[13px] text-neutral-700 leading-relaxed">
        The sample lives in <strong>{taskSetName}</strong>, and that set is managed by this design:
        tasks cannot be added to it, imported into it or moved into it by hand. Every point in it
        has a known probability of having been chosen, and one extra task would quietly invalidate
        the estimate.
      </p>
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</dt>
    <dd className="mt-1 text-lg font-semibold text-neutral-900 tabular-nums">{value}</dd>
  </div>
);
