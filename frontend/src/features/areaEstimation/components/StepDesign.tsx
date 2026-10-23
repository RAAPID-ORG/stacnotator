import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Badge } from '~/shared/ui/Badge';
import { Button, Field, Input, Select } from '~/shared/ui/forms';
import { InfoPopover } from '~/shared/ui/InfoPopover';
import type { AllocationRule } from '../core/design';
import { stratumWeights } from '../core/design';
import { PRECISION_PRESETS } from '../core/guidance';
import type { AreaEstimationPlan, DomainDesign } from '../core/plan';
import { designsOf, planNeedsPilot, precisionCurves, totalPoints } from '../core/plan';
import { ChoiceCard, choiceCardCls, Note, RICH_TEXT, StepHeading, SubHeading } from './Explain';
import { PrecisionCurve } from './PrecisionCurve';
import { formatCount, formatPercent } from './format';

interface Props {
  plan: AreaEstimationPlan;
  update: (patch: Partial<AreaEstimationPlan>) => void;
}

const RULES: AllocationRule[] = ['neyman', 'proportional', 'equal'];

/**
 * Sample sizes to evaluate the curve at: from well under the current design to
 * well over it, so the knee is on screen wherever the design happens to sit.
 */
const curveTotals = (requested: number): number[] => {
  const top = Math.max(200, Math.round(requested * 2.5));
  return [...Array.from({ length: 45 }, (_, i) => Math.round((top * (i + 1)) / 45)), requested];
};

export const StepDesign = ({ plan, update }: Props) => {
  const { t } = useTranslation('areaEstimation');
  const [advanced, setAdvanced] = useState(false);
  const [customPilot, setCustomPilot] = useState(false);
  const isCustom = !PRECISION_PRESETS.some((p) => Math.abs(plan.targetCv - p.cv) < 1e-9);
  const designs = designsOf(plan);
  const pilot = planNeedsPilot(plan);
  const total = totalPoints(designs);
  const hasOverrides = Object.keys(plan.overrides).length > 0;

  const setPoints = (stratumId: string, n: number) =>
    update({ overrides: { ...plan.overrides, [stratumId]: Math.max(0, Math.round(n)) } });

  if (pilot) {
    return (
      <div className="space-y-8">
        <StepHeading title={t('design.pilotTitle')} technical={<p>{t('design.pilotTechnical')}</p>}>
          {t('design.pilotIntro')}
        </StepHeading>

        {!customPilot ? (
          <button
            type="button"
            onClick={() => setCustomPilot(true)}
            className="text-sm text-neutral-500 hover:text-neutral-700 underline underline-offset-4 cursor-pointer self-start"
            data-testid="uae-customize-pilot"
          >
            {t('design.customizePilot')}
          </button>
        ) : (
          <div className="flex flex-wrap items-start gap-6">
            <Field label={t('design.budget')} hint={t('design.budgetHint')} className="w-[15rem]">
              <Input
                type="number"
                size="sm"
                min={5}
                max={500}
                step={5}
                value={plan.pilotBudgetPerClass}
                onChange={(e) =>
                  update({ pilotBudgetPerClass: Number(e.target.value), overrides: {} })
                }
                data-testid="uae-pilot-budget"
              />
            </Field>
            <Field label={t('design.floor')} hint={t('design.floorHint')} className="w-[15rem]">
              <Input
                type="number"
                size="sm"
                min={0}
                max={500}
                step={5}
                value={plan.pilotFloorPerClass}
                onChange={(e) =>
                  update({ pilotFloorPerClass: Number(e.target.value), overrides: {} })
                }
                data-testid="uae-pilot-floor"
              />
            </Field>
          </div>
        )}

        {designs.map((design) => (
          <div key={design.domain.id} className="space-y-2">
            {designs.length > 1 && (
              <h3 className="text-sm font-medium text-neutral-900">{design.domain.name}</h3>
            )}
            <DesignTable plan={plan} design={design} pilot onSetPoints={setPoints} />
          </div>
        ))}

        <TotalsBar total={total} pilot />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <StepHeading
        title={t('design.title')}
        technical={
          <p>
            <Trans t={t} i18nKey="design.technical" components={RICH_TEXT} />
          </p>
        }
        source={t('design.source')}
      >
        <Trans t={t} i18nKey="design.intro" components={RICH_TEXT} />
      </StepHeading>

      <section className="space-y-3">
        <SubHeading
          title={t('design.targetTitle')}
          technical={<p>{t('design.targetTechnical')}</p>}
          source={t('design.targetSource')}
        >
          {t('design.targetIntro')}
        </SubHeading>
        <Field className="max-w-sm">
          <Select
            value={plan.targetClassId ?? ''}
            onChange={(e) => update({ targetClassId: e.target.value || null, overrides: {} })}
            data-testid="uae-target-class"
          >
            <option value="">{t('design.chooseClass')}</option>
            {plan.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || t('unnamedClass')}
              </option>
            ))}
          </Select>
        </Field>
      </section>

      <section className="space-y-3">
        <SubHeading
          title={t('design.precisionTitle')}
          technical={<p>{t('design.precisionTechnical')}</p>}
        >
          <Trans t={t} i18nKey="design.precisionIntro" components={RICH_TEXT} />
        </SubHeading>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PRECISION_PRESETS.map((preset) => (
            <ChoiceCard
              key={preset.cv}
              selected={Math.abs(plan.targetCv - preset.cv) < 1e-9}
              onSelect={() => update({ targetCv: preset.cv, overrides: {} })}
              title={t(`design.presets.${preset.id}.title`)}
              badge={
                <Badge tone={preset.cv <= 0.02 ? 'purple' : 'neutral'}>
                  ±{formatPercent(preset.cv, 0)}
                </Badge>
              }
              testId={`uae-cv-${preset.cv}`}
            >
              {t(`design.presets.${preset.id}.example`)}
            </ChoiceCard>
          ))}

          <label className={choiceCardCls(isCustom)}>
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium text-neutral-900">
                {t('design.somethingElse')}
              </span>
              {isCustom && <Badge tone="brand">±{formatPercent(plan.targetCv, 0)}</Badge>}
            </span>
            <span className="mt-1 flex items-center gap-2">
              {/* Input is w-full; the fixed width has to come from a wrapper. */}
              <span className="w-16 shrink-0">
                {/* Empty until it is the one in use, so it reads as somewhere
                    to type rather than as a preset already showing a number. */}
                <Input
                  type="number"
                  size="sm"
                  min={0.5}
                  max={50}
                  step={0.5}
                  placeholder="7"
                  aria-label={t('design.customAria')}
                  value={isCustom ? Number((plan.targetCv * 100).toFixed(2)) : ''}
                  onChange={(e) =>
                    update({ targetCv: Number(e.target.value) / 100, overrides: {} })
                  }
                  data-testid="uae-cv-custom"
                />
              </span>
              <span className="text-xs text-neutral-600 leading-snug">
                {t('design.customHint')}
              </span>
            </span>
          </label>
        </div>
      </section>

      {hasOverrides && (
        <Note tone="warning">
          <div className="flex items-center justify-between gap-3">
            <span>{t('design.overridden')}</span>
            <Button size="sm" variant="secondary" onClick={() => update({ overrides: {} })}>
              {t('design.reset')}
            </Button>
          </div>
        </Note>
      )}

      {designs.map((design) => (
        <section key={design.domain.id} className="space-y-3">
          {designs.length > 1 && (
            <h3 className="text-sm font-medium text-neutral-900">{design.domain.name}</h3>
          )}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
            <DesignTable plan={plan} design={design} onSetPoints={setPoints} />
            <PrecisionCurve
              series={precisionCurves(plan, design.domain, curveTotals(design.requestedTotal))}
              currentTotal={design.total}
              targetCv={plan.targetCv}
              targetClassId={plan.targetClassId}
            />
          </div>
        </section>
      ))}

      <button
        type="button"
        onClick={() => setAdvanced(!advanced)}
        className="h-9 self-start text-sm text-neutral-500 hover:text-neutral-700 underline underline-offset-4 cursor-pointer"
        data-testid="uae-advanced"
      >
        {advanced ? t('design.hideAdvanced') : t('design.advanced')}
      </button>

      {advanced && (
        <section className="space-y-6 border-t border-neutral-100 pt-6">
          <Field
            label={
              <span className="inline-flex items-center gap-1">
                {t('design.floorLabel')}
                <InfoPopover>{t('design.floorRationale')}</InfoPopover>
              </span>
            }
            className="w-[13rem]"
          >
            <Input
              type="number"
              size="sm"
              min={0}
              max={1000}
              step={5}
              value={plan.sampleFloor}
              onChange={(e) => update({ sampleFloor: Number(e.target.value), overrides: {} })}
              data-testid="uae-sample-floor"
            />
          </Field>

          <SubHeading
            title={t('design.allocationTitle')}
            technical={
              <p>
                <Trans t={t} i18nKey="design.allocationTechnical" components={RICH_TEXT} />
              </p>
            }
            source={t('design.allocationSource')}
          >
            {t('design.allocationIntro')}
          </SubHeading>
          <div className="space-y-1.5">
            {RULES.map((rule) => (
              <label
                key={rule}
                className="flex items-start gap-2.5 cursor-pointer rounded p-1.5 hover:bg-neutral-50"
              >
                <input
                  type="radio"
                  name="uae-allocation"
                  className="mt-1 cursor-pointer"
                  checked={plan.allocationRule === rule}
                  onChange={() => update({ allocationRule: rule, overrides: {} })}
                  data-testid={`uae-rule-${rule}`}
                />
                <span>
                  <span className="block text-sm text-neutral-900">
                    {t(`design.rules.${rule}.name`)}
                  </span>
                  <span className="block text-xs text-neutral-500 leading-snug">
                    {t(`design.rules.${rule}.description`)}
                  </span>
                  <span className="mt-0.5 block text-xs text-neutral-400 leading-snug">
                    {t(`design.rules.${rule}.theory`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>
      )}

      <TotalsBar total={total} />
    </div>
  );
};

const DesignTable = ({
  plan,
  design,
  pilot = false,
  onSetPoints,
}: {
  plan: AreaEstimationPlan;
  design: DomainDesign;
  /** A pilot has no prior to show and no target to meet. */
  pilot?: boolean;
  onSetPoints: (stratumId: string, n: number) => void;
}) => {
  const { t } = useTranslation('areaEstimation');
  const weights = stratumWeights(design.domain.strata);
  const byId = new Map(design.allocation.map((a) => [a.id, a.n]));
  const meetsTarget = design.precision.cv <= plan.targetCv;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
          <th className="py-2 font-medium">{t('table.stratum')}</th>
          <th className="py-2 font-medium w-28 text-right">{t('table.stratumWeight')}</th>
          <th className="py-2 pl-10 font-medium w-32 text-right">{t('table.sampleSize')}</th>
        </tr>
      </thead>
      <tbody>
        {design.domain.strata.map((stratum, i) => (
          <tr key={stratum.id} className="border-b border-neutral-100">
            <td className="py-2 text-neutral-800">
              {stratum.className}
              {stratum.classId === plan.targetClassId && (
                <Badge tone="brand" className="ml-2">
                  {t('badges.target')}
                </Badge>
              )}
              {stratum.isNoData && (
                <Badge tone="neutral" className="ml-2">
                  {t('badges.notReported')}
                </Badge>
              )}
            </td>
            <td className="py-2 text-right text-neutral-600 tabular-nums">
              {formatPercent(weights[i])}
            </td>
            <td className="py-2 pl-10">
              <Input
                type="number"
                size="sm"
                min={0}
                className="text-right tabular-nums"
                aria-label={t('design.sampleSizeAria', { name: stratum.className })}
                value={byId.get(stratum.id) ?? 0}
                onChange={(e) => onSetPoints(stratum.id, Number(e.target.value))}
              />
            </td>
          </tr>
        ))}
      </tbody>
      {!pilot && (
        <tfoot>
          <tr>
            <td className="pt-3 text-sm text-neutral-700">{t('design.expectedForTarget')}</td>
            <td colSpan={2} className="pt-3 pl-10 text-right">
              <Badge tone={meetsTarget ? 'green' : 'yellow'}>
                ±{formatPercent(design.precision.cv)}
                {meetsTarget
                  ? ''
                  : t('design.belowTarget', { target: formatPercent(plan.targetCv, 0) })}
              </Badge>
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
};

const TotalsBar = ({ total, pilot }: { total: number; pilot?: boolean }) => {
  const { t } = useTranslation('areaEstimation');
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
      <span className="text-2xl font-semibold text-neutral-900 tabular-nums">
        {formatCount(total)}
      </span>
      <span className="ml-2 text-sm text-neutral-600">
        {pilot ? t('design.unitsInPilot') : t('design.unitsToAnnotate')}
      </span>
    </div>
  );
};
