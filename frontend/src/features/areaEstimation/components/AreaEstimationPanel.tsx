import { useEffect, useState } from 'react';
import { Badge } from '~/shared/ui/Badge';
import { Button } from '~/shared/ui/forms';
import { Delayed } from '~/shared/ui/Delayed';
import { SkeletonRows } from '~/shared/ui/Skeleton';
import { loadPlan, loadProgress, type Progress } from '../api';
import type { AreaEstimates } from '../core/estimate';
import { estimateAreas } from '../core/estimate';
import type { AreaEstimationPlan } from '../core/plan';
import { domainsOf, planNeedsPilot } from '../core/plan';
import { Note, SubHeading } from './Explain';
import { formatArea, formatCount, formatPercent } from './format';

/**
 * The running estimate, for campaign admins only.
 *
 * Interim numbers from a partly annotated sample are unbiased but wide, and a
 * wide number quoted out of context is worse than no number. Annotators also
 * must not see them: knowing the running total is exactly the kind of thing
 * that pulls a borderline label one way.
 */
/** Stands in until annotation counts come from the backend. */
const PREVIEW_FRACTION = 0.4;

export const AreaEstimationPanel = ({
  campaignId,
  taskSetId,
  taskSetName,
  showEstimates = true,
  onAnnotate,
  onOpenDesign,
}: {
  campaignId: number;
  taskSetId: number;
  taskSetName?: string;
  /** The running numbers are for admins; the points are for everyone. */
  showEstimates?: boolean;
  onAnnotate?: () => void;
  onOpenDesign?: () => void;
}) => {
  const [plan, setPlan] = useState<AreaEstimationPlan | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void loadPlan(campaignId, taskSetId).then((stored) => {
      if (cancelled) return;
      setPlan(stored);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId, taskSetId]);

  useEffect(() => {
    if (!plan || !plan.activatedAt) return;
    let cancelled = false;
    void loadProgress(taskSetId, plan, PREVIEW_FRACTION).then((p) => {
      if (!cancelled) setProgress(p);
    });
    return () => {
      cancelled = true;
    };
  }, [taskSetId, plan]);

  if (loading) {
    return (
      <Delayed>
        <SkeletonRows count={3} />
      </Delayed>
    );
  }
  if (!plan) return null;

  const domains = domainsOf(plan);
  const classIds = plan.classes.map((c) => c.id);
  const pilot = planNeedsPilot(plan);
  const drawn = plan.activatedAt !== null && plan.raster !== null;
  const done = progress?.annotated ?? 0;
  const planned = progress?.planned ?? 0;

  return (
    <div className="surface h-full flex flex-col">
      <div className="surface-section space-y-4 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold text-neutral-900 truncate">
              {taskSetName ?? 'Area estimate'}
            </p>
            <p className="text-sm text-neutral-500 mt-0.5">
              {drawn ? (pilot ? 'Pilot sample running' : 'Sampling') : 'Design not finished yet'}
            </p>
          </div>
          <Badge tone={drawn ? (pilot ? 'yellow' : 'brand') : 'neutral'}>
            {drawn ? (pilot ? 'Pilot' : 'Active') : 'Draft'}
          </Badge>
        </div>

        {drawn && (
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-neutral-700">
                {formatCount(done)} of {formatCount(planned)} sample points annotated
              </span>
              <span className="text-neutral-500 tabular-nums">
                {planned > 0 ? formatPercent(done / planned, 0) : '-'}
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-neutral-100">
              <div
                className="h-1.5 rounded-full bg-brand-600 transition-[width]"
                style={{ width: `${planned > 0 ? Math.min(100, (done / planned) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}

        {showEstimates && drawn && done < planned && (
          <Note tone="warning">
            The sample is incomplete. These figures are already unbiased, but their confidence
            intervals will keep narrowing, and any point still unannotated could move them. Do not
            publish them yet.
          </Note>
        )}

        {showEstimates && drawn && (
          <SubHeading
            title="Reading these numbers"
            technical={
              <>
                <p>
                  Areas come from the stratified estimator: p̂<sub>k</sub> = Σ W<sub>i</sub>
                  (n<sub>ik</sub>/n<sub>i</sub>), with the standard error of Olofsson Eq. 10 and a
                  95% interval of ±1.96 standard errors. The map column is the pixel-counting figure
                  and is shown only so the size of the map&apos;s bias is visible.
                </p>
                <p className="mt-1.5">
                  Map correct is user&apos;s accuracy (Eq. 1, variance Eq. 6); map found is
                  producer&apos;s accuracy (Eq. 3, variance Eq. 7). They answer different questions
                  and are rarely equal: a class the map over-calls scores low on the first and high
                  on the second.
                </p>
              </>
            }
            source="Olofsson et al. (2014), Eqs. 9 to 11."
          >
            Each row is what the annotated points say the area really is, with the range it could
            plausibly be. Where the map column sits outside that range, the map was systematically
            over- or under-calling that class. <strong>Map correct</strong> is how much of what the
            map called this class really was it; <strong>map found</strong> is how much of what
            really was this class the map caught.
          </SubHeading>
        )}

        {showEstimates &&
          drawn &&
          domains.map((domain) => {
            const samples = progress?.samples[domain.id] ?? [];
            if (samples.length === 0) return null;
            const estimates = estimateAreas(samples, classIds, plan.raster?.areaPerPixel ?? 0);
            return (
              <EstimateTable
                key={domain.id}
                title={domains.length > 1 ? domain.name : null}
                plan={plan}
                estimates={estimates}
              />
            );
          })}
      </div>

      {(onAnnotate || onOpenDesign) && (
        <div className="surface-section flex items-center gap-2">
          {onAnnotate && (
            <Button variant="secondary" onClick={onAnnotate} disabled={!drawn} className="flex-1">
              Annotate
            </Button>
          )}
          {onOpenDesign && (
            <Button variant="secondary" onClick={onOpenDesign} className="flex-1">
              {drawn ? 'Design' : 'Finish setup'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

const EstimateTable = ({
  title,
  plan,
  estimates,
}: {
  title: string | null;
  plan: AreaEstimationPlan;
  estimates: AreaEstimates;
}) => (
  <div className="space-y-1.5">
    {title && <h3 className="text-sm font-medium text-neutral-900">{title}</h3>}
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[34rem]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
            <th className="py-2 font-medium">Class</th>
            <th className="py-2 font-medium text-right">Estimated area</th>
            <th className="py-2 font-medium text-right w-20">±</th>
            <th className="py-2 font-medium text-right w-28">Map says</th>
            <th
              className="py-2 font-medium text-right w-28"
              title="User's accuracy: of what the map calls this class, how much really is"
            >
              Map correct
            </th>
            <th
              className="py-2 font-medium text-right w-28"
              title="Producer's accuracy: of what really is this class, how much the map found"
            >
              Map found
            </th>
          </tr>
        </thead>
        <tbody>
          {estimates.classes.map((estimate) => {
            const name =
              plan.classes.find((c) => c.id === estimate.classId)?.name ?? estimate.classId;
            return (
              <tr key={estimate.classId} className="border-b border-neutral-100">
                <td className="py-2 text-neutral-800">
                  {name}
                  {estimate.classId === plan.targetClassId && (
                    <Badge tone="brand" className="ml-2">
                      target
                    </Badge>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums font-medium text-neutral-900">
                  {formatArea(estimate.area)}
                </td>
                <td className="py-2 text-right tabular-nums text-neutral-600">
                  {formatArea(estimate.areaMarginOfError)}
                </td>
                <td className="py-2 text-right tabular-nums text-neutral-500">
                  {formatArea(estimate.mappedArea)}
                </td>
                <td className="py-2 text-right tabular-nums text-neutral-500">
                  {estimate.usersAccuracy ? formatPercent(estimate.usersAccuracy.value, 0) : '-'}
                </td>
                <td className="py-2 text-right tabular-nums text-neutral-500">
                  {estimate.producersAccuracy
                    ? formatPercent(estimate.producersAccuracy.value, 0)
                    : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
        {estimates.overallAccuracy && (
          <tfoot>
            <tr>
              <td colSpan={6} className="pt-3 text-xs text-neutral-500">
                Overall map accuracy {formatPercent(estimates.overallAccuracy.value, 1)} ±{' '}
                {formatPercent(estimates.overallAccuracy.marginOfError, 1)}, from{' '}
                {formatCount(estimates.totalAnnotated)} annotated points.
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  </div>
);
