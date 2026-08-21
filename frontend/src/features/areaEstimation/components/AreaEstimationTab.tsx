import { useCallback, useEffect, useState } from 'react';
import { createTaskSet, deleteTaskSet } from '~/api/client';
import { Badge } from '~/shared/ui/Badge';
import { Button } from '~/shared/ui/forms';
import { Delayed } from '~/shared/ui/Delayed';
import { SkeletonForm } from '~/shared/ui/Skeleton';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import { clearPlan, loadPlan, savePlan } from '../api';
import type { AreaEstimationPlan } from '../core/plan';
import { designsOf, emptyPlan, planNeedsPilot, totalPoints, validatePlan } from '../core/plan';
import { AREA_ESTIMATION_TASK_SET_NAME } from '../taskSet';
import { Explain, StepHeading } from './Explain';
import { PlanWizard } from './PlanWizard';
import { formatCount, formatPercent } from './format';

interface Props {
  campaignId: number;
  onTaskSetsChanged?: () => void;
}

export const AreaEstimationTab = ({ campaignId, onTaskSetsChanged }: Props) => {
  const [plan, setPlan] = useState<AreaEstimationPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [activating, setActivating] = useState(false);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);

  useEffect(() => {
    let cancelled = false;
    void loadPlan(campaignId).then((stored) => {
      if (cancelled) return;
      setPlan(stored);
      setEditing(stored !== null && stored.activatedAt === null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const update = useCallback(
    (patch: Partial<AreaEstimationPlan>) =>
      setPlan((current) => {
        const next = { ...(current ?? emptyPlan()), ...patch };
        void savePlan(campaignId, next);
        return next;
      }),
    [campaignId]
  );

  const start = () => {
    const fresh = emptyPlan();
    setPlan(fresh);
    setEditing(true);
    void savePlan(campaignId, fresh);
  };

  const activate = async () => {
    if (!plan) return;
    setActivating(true);
    try {
      let taskSetId = plan.taskSetId;
      if (taskSetId === null) {
        const created = await createTaskSet({
          path: { campaign_id: campaignId },
          body: { name: AREA_ESTIMATION_TASK_SET_NAME },
        });
        if (created.error || !created.data) throw created.error ?? new Error('No task set');
        taskSetId = created.data.id;
      }
      update({ taskSetId, activatedAt: new Date().toISOString() });
      setEditing(false);
      onTaskSetsChanged?.();
      showAlert('Area estimation is set up. The sample points will be drawn next.', 'success');
    } catch (err) {
      handleError(err, 'Could not set up the area estimation sample');
    } finally {
      setActivating(false);
    }
  };

  const turnOff = async () => {
    if (!plan) return;
    const confirmed = await showConfirmDialog({
      title: 'Turn off area estimation?',
      description:
        'The sample design and its task set are deleted, along with any annotations made on those points. Annotations in other task sets are untouched.',
      confirmText: 'Turn off',
      isDangerous: true,
    });
    if (!confirmed) return;
    try {
      if (plan.taskSetId !== null) {
        await deleteTaskSet({
          path: { campaign_id: campaignId, task_set_id: plan.taskSetId },
        });
      }
      await clearPlan(campaignId);
      setPlan(null);
      setEditing(false);
      onTaskSetsChanged?.();
      showAlert('Area estimation turned off', 'success');
    } catch (err) {
      handleError(err, 'Could not turn off area estimation');
    }
  };

  if (loading) {
    return (
      <div id="tab-area-estimation" role="tabpanel">
        <Delayed>
          <SkeletonForm sections={2} />
        </Delayed>
      </div>
    );
  }

  return (
    <div id="tab-area-estimation" role="tabpanel" className="space-y-6">
      {plan === null && <Intro onStart={start} />}

      {plan !== null && editing && (
        <PlanWizard
          plan={plan}
          update={update}
          onActivate={() => void activate()}
          activating={activating}
          onCancel={plan.activatedAt ? () => setEditing(false) : undefined}
        />
      )}

      {plan !== null && !editing && (
        <ActiveSummary
          plan={plan}
          onEdit={() => setEditing(true)}
          onTurnOff={() => void turnOff()}
        />
      )}
    </div>
  );
};

const Intro = ({ onStart }: { onStart: () => void }) => (
  <div className="space-y-6">
    <StepHeading title="Unbiased area estimation">
      Turn this campaign into a statistically defensible area estimate: how much cropland, forest or
      built-up land there really is, with a confidence interval you can publish.
    </StepHeading>

    <Explain
      technical={
        <p>
          The campaign becomes the response design of a stratified random sample. The map supplies
          the strata, annotators supply the reference classification, and areas are estimated from
          the reference labels with the stratified estimator rather than from mapped pixel counts.
        </p>
      }
      source="Following Olofsson et al. (2014), Remote Sensing of Environment 148, 42-57."
    >
      You supply a classified map and the areas you report on. The tool works out how many points to
      check and where, annotators check them, and the area comes out of what they saw -with an
      honest margin of error. The map only makes the sample efficient; it never enters the answer.
    </Explain>

    <ol className="space-y-2 text-sm text-neutral-700">
      {[
        'Upload the map and the areas you report on.',
        'Say which classes you publish, merging map classes if you need to.',
        'Choose the class that matters most and how precise it has to be.',
        'Tell the tool what you already know about the map, or start with a pilot.',
        'Review the sample design and let the campaign draw its points.',
      ].map((text, i) => (
        <li key={text} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-600">
            {i + 1}
          </span>
          <span className="pt-0.5">{text}</span>
        </li>
      ))}
    </ol>

    <Button onClick={onStart} data-testid="uae-start">
      Set up area estimation
    </Button>
  </div>
);

const ActiveSummary = ({
  plan,
  onEdit,
  onTurnOff,
}: {
  plan: AreaEstimationPlan;
  onEdit: () => void;
  onTurnOff: () => void;
}) => {
  const designs = designsOf(plan);
  const issues = validatePlan(plan);
  const pilot = planNeedsPilot(plan);
  const target = plan.classes.find((c) => c.id === plan.targetClassId);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <StepHeading title="Unbiased area estimation">
          {pilot
            ? 'A pilot sample is running. The full design is proposed once it is annotated.'
            : `Sized for ${target?.name ?? 'the target class'} at ±${formatPercent(plan.targetCv, 0)}.`}
        </StepHeading>
        <div className="flex items-center gap-2 shrink-0">
          <Badge tone={issues.length > 0 ? 'yellow' : 'green'}>
            {issues.length > 0 ? 'Needs attention' : pilot ? 'Pilot' : 'Active'}
          </Badge>
          <Button size="sm" variant="secondary" onClick={onEdit}>
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
          value={pilot ? '—' : `±${formatPercent(Math.max(...designs.map((d) => d.precision.cv)))}`}
        />
      </dl>

      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-[13px] text-neutral-700 leading-relaxed">
        The sample lives in the <strong>{AREA_ESTIMATION_TASK_SET_NAME}</strong> task set. That set
        is managed by the design: tasks cannot be added to it, imported into it or moved into it by
        hand. Every point in it has a known probability of having been chosen, and one extra task
        would quietly invalidate the estimate.
      </div>

      <section className="pt-6 mt-6 border-t border-red-200">
        <h2 className="text-sm font-semibold text-red-700 mb-2">Danger zone</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Turning area estimation off deletes the sample and everything annotated on it.
        </p>
        <Button variant="danger" onClick={onTurnOff}>
          Turn off area estimation
        </Button>
      </section>
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</dt>
    <dd className="mt-1 text-lg font-semibold text-neutral-900 tabular-nums">{value}</dd>
  </div>
);
