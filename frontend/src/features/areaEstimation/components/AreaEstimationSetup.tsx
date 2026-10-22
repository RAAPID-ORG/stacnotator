import { useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Badge } from '~/shared/ui/Badge';
import { Button } from '~/shared/ui/forms';
import { SkeletonForm } from '~/shared/ui/Skeleton';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import { loadPlan, savePlan } from '../api';
import type { AreaEstimationPlan } from '../core/plan';
import { designsOf, emptyPlan, planNeedsPilot, totalPoints, validatePlan } from '../core/plan';
import { RICH_TEXT, StepHeading } from './Explain';
import { PlanWizard } from './PlanWizard';
import { formatCount, formatPercent } from './format';

interface Props {
  campaignId: number;
  /** The task set this design owns, and whose sample it draws. */
  taskSetId: number;
  taskSetName: string;
  /**
   * Whether the wizard is open, so the page hosting it can clear the way: the
   * set list and the task table are noise while a design is being written, and
   * repeat on every step of it.
   */
  onEditingChange?: (editing: boolean) => void;
}

/**
 * The design attached to one task set. The set exists before the design does,
 * so this never creates one: it edits the plan the set was created with.
 */
export const AreaEstimationSetup = ({
  campaignId,
  taskSetId,
  taskSetName,
  onEditingChange,
}: Props) => {
  const { t } = useTranslation('areaEstimation');
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

  useEffect(() => onEditingChange?.(editing), [editing, onEditingChange]);

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
      showAlert(t('setup.activated'), 'success');
    } catch (err) {
      handleError(err, t('setup.saveFailed'));
    } finally {
      setActivating(false);
    }
  };

  if (loading || !plan) {
    return <SkeletonForm sections={2} />;
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
  const { t } = useTranslation('areaEstimation');
  const designs = designsOf(plan);
  const issues = validatePlan(plan);
  const pilot = planNeedsPilot(plan);
  const target = plan.classes.find((c) => c.id === plan.targetClassId);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <StepHeading title={t('setup.title')}>
          {pilot
            ? t('setup.pilotRunning')
            : t('setup.sizedFor', {
                target: target?.name ?? t('setup.theTargetClass'),
                cv: formatPercent(plan.targetCv, 0),
              })}
        </StepHeading>
        <div className="flex items-center gap-2 shrink-0">
          <Badge tone={issues.length > 0 ? 'yellow' : 'green'}>
            {issues.length > 0
              ? t('badges.needsAttention')
              : pilot
                ? t('badges.pilot')
                : t('badges.active')}
          </Badge>
          <Button size="sm" variant="secondary" onClick={onEdit} data-testid="uae-edit-design">
            {t('setup.editDesign')}
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label={t('setup.stats.sampleSize')} value={formatCount(totalPoints(designs))} />
        <Stat label={t('setup.stats.strata')} value={String(plan.classes.length)} />
        <Stat
          label={t('setup.stats.areas')}
          value={
            plan.domainMode === 'per_area'
              ? t('setup.stats.areasSeparate', { n: plan.areas.length })
              : t('setup.stats.areasCombined', { n: plan.areas.length })
          }
        />
        <Stat
          label={t('setup.stats.expectedPrecision')}
          value={pilot ? '-' : `±${formatPercent(Math.max(...designs.map((d) => d.precision.cv)))}`}
        />
      </dl>

      <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-[13px] text-neutral-700 leading-relaxed">
        <Trans
          t={t}
          i18nKey="setup.lockedNote"
          values={{ name: taskSetName }}
          components={RICH_TEXT}
        />
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
