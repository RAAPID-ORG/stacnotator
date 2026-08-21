import { useEffect, useState } from 'react';
import { Badge } from '~/shared/ui/Badge';
import { Delayed } from '~/shared/ui/Delayed';
import { SkeletonRows } from '~/shared/ui/Skeleton';
import { loadPlan, loadProgress, type Progress } from '../api';
import type { AreaEstimates } from '../core/estimate';
import { estimateAreas } from '../core/estimate';
import type { AreaEstimationPlan } from '../core/plan';
import { domainsOf, planNeedsPilot } from '../core/plan';
import { Explain, Note } from './Explain';
import { formatArea, formatCount, formatPercent } from './format';

/**
 * The running estimate, for campaign admins only.
 *
 * Interim numbers from a partly annotated sample are unbiased but wide, and a
 * wide number quoted out of context is worse than no number. Annotators also
 * must not see them: knowing the running total is exactly the kind of thing
 * that pulls a borderline label one way.
 */
export const AreaEstimationPanel = ({ campaignId }: { campaignId: number }) => {
  const [plan, setPlan] = useState<AreaEstimationPlan | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(0.4);

  useEffect(() => {
    let cancelled = false;
    void loadPlan(campaignId).then((stored) => {
      if (cancelled) return;
      setPlan(stored);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  useEffect(() => {
    if (!plan || !plan.activatedAt) return;
    let cancelled = false;
    void loadProgress(campaignId, plan, preview).then((p) => {
      if (!cancelled) setProgress(p);
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId, plan, preview]);

  if (loading) {
    return (
      <Delayed>
        <SkeletonRows count={3} />
      </Delayed>
    );
  }
  if (!plan || !plan.activatedAt || !plan.raster) return null;

  const domains = domainsOf(plan);
  const classIds = plan.classes.map((c) => c.id);
  const pilot = planNeedsPilot(plan);
  const done = progress?.annotated ?? 0;
  const planned = progress?.planned ?? 0;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-heading">Area estimate</h2>
        <div className="flex items-center gap-2">
          <Badge tone={pilot ? 'yellow' : 'brand'}>{pilot ? 'Pilot running' : 'Sampling'}</Badge>
          <Badge tone="neutral">Admins only</Badge>
        </div>
      </div>

      <div className="surface">
        <div className="surface-section space-y-4">
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-neutral-700">
                {formatCount(done)} of {formatCount(planned)} sample points annotated
              </span>
              <span className="text-neutral-500 tabular-nums">
                {planned > 0 ? formatPercent(done / planned, 0) : '—'}
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-neutral-100">
              <div
                className="h-1.5 rounded-full bg-brand-600 transition-[width]"
                style={{ width: `${planned > 0 ? Math.min(100, (done / planned) * 100) : 0}%` }}
              />
            </div>
          </div>

          {done < planned && (
            <Note tone="warning">
              The sample is incomplete. These figures are already unbiased, but their confidence
              intervals will keep narrowing, and any point still unannotated could move them. Do not
              publish them yet.
            </Note>
          )}

          {domains.map((domain) => {
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

          <Explain
            technical={
              <p>
                Areas come from the stratified estimator: p̂<sub>k</sub> = Σ W<sub>i</sub>
                (n<sub>ik</sub>/n<sub>i</sub>), with the standard error of Olofsson Eq. 10 and a 95%
                interval of ±1.96 standard errors. The map column is the pixel-counting figure and
                is shown only so the size of the map&apos;s bias is visible.
              </p>
            }
            source="Olofsson et al. (2014), Eqs. 9 to 11."
          >
            Each row is what the annotated points say the area really is, with the range it could
            plausibly be. Where the map column sits outside that range, the map was systematically
            over- or under-calling that class.
          </Explain>

          <div className="rounded-lg border border-dashed border-neutral-300 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-neutral-500">Preview control</p>
            <p className="mt-1 text-xs text-neutral-500 leading-snug">
              Annotation counts are not wired to the backend yet. Drag to see how the estimates
              behave as the sample fills up.
            </p>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(preview * 100)}
              onChange={(e) => setPreview(Number(e.target.value) / 100)}
              className="mt-2 w-full cursor-pointer"
              aria-label="Preview annotation progress"
            />
          </div>
        </div>
      </div>
    </section>
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
            <th className="py-2 font-medium text-right w-24">Map right</th>
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
                  {estimate.usersAccuracy ? formatPercent(estimate.usersAccuracy.value, 0) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
        {estimates.overallAccuracy && (
          <tfoot>
            <tr>
              <td colSpan={5} className="pt-3 text-xs text-neutral-500">
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
