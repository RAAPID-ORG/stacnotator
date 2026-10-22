import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Badge } from '~/shared/ui/Badge';
import { Button } from '~/shared/ui/forms';
import { SkeletonRows } from '~/shared/ui/Skeleton';
import { loadPlan, loadProgress, type Progress } from '../api';
import type { AreaEstimates } from '../core/estimate';
import { estimateAreas } from '../core/estimate';
import type { AreaEstimationPlan } from '../core/plan';
import { domainsOf, planNeedsPilot } from '../core/plan';
import { Note, RICH_TEXT, SubHeading } from './Explain';
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
  /** The running numbers are for admins; the sampling units are for everyone. */
  showEstimates?: boolean;
  onAnnotate?: () => void;
  onOpenDesign?: () => void;
}) => {
  const { t } = useTranslation('areaEstimation');
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
    return <SkeletonRows count={3} />;
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
              {taskSetName ?? t('panel.defaultTitle')}
            </p>
            <p className="text-sm text-neutral-500 mt-0.5">
              {drawn
                ? pilot
                  ? t('panel.pilotRunning')
                  : t('panel.sampling')
                : t('panel.notFinished')}
            </p>
          </div>
          <Badge tone={drawn ? (pilot ? 'yellow' : 'brand') : 'neutral'}>
            {drawn ? (pilot ? t('badges.pilot') : t('badges.active')) : t('badges.draft')}
          </Badge>
        </div>

        {drawn && (
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-neutral-700">
                {t('panel.progress', { done: formatCount(done), planned: formatCount(planned) })}
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
          <Note tone="warning">{t('panel.incomplete')}</Note>
        )}

        {showEstimates && drawn && (
          <SubHeading
            title={t('panel.reading.title')}
            technical={
              <>
                <p>
                  <Trans t={t} i18nKey="panel.reading.technical1" components={RICH_TEXT} />
                </p>
                <p className="mt-1.5">{t('panel.reading.technical2')}</p>
              </>
            }
            source={t('panel.reading.source')}
          >
            <Trans t={t} i18nKey="panel.reading.body" components={RICH_TEXT} />
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
              {t('panel.annotate')}
            </Button>
          )}
          {onOpenDesign && (
            <Button variant="secondary" onClick={onOpenDesign} className="flex-1">
              {drawn ? t('panel.design') : t('panel.finishSetup')}
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
}) => {
  const { t } = useTranslation('areaEstimation');
  return (
    <div className="space-y-1.5">
      {title && <h3 className="text-sm font-medium text-neutral-900">{title}</h3>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[34rem]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
              <th className="py-2 font-medium">{t('panel.columns.class')}</th>
              <th className="py-2 font-medium text-right">{t('panel.columns.estimatedArea')}</th>
              <th className="py-2 font-medium text-right w-20">±</th>
              <th className="py-2 font-medium text-right w-28">{t('panel.columns.mapSays')}</th>
              <th className="py-2 font-medium text-right w-28" title={t('panel.columns.uaTitle')}>
                {t('panel.columns.ua')}
              </th>
              <th className="py-2 font-medium text-right w-28" title={t('panel.columns.paTitle')}>
                {t('panel.columns.pa')}
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
                        {t('badges.target')}
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
                  {t('panel.overall', {
                    accuracy: formatPercent(estimates.overallAccuracy.value, 1),
                    margin: formatPercent(estimates.overallAccuracy.marginOfError, 1),
                    units: formatCount(estimates.totalAnnotated),
                  })}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};
