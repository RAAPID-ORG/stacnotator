import { useState } from 'react';
import { Badge } from '~/shared/ui/Badge';
import { Button, Field, Input, Select } from '~/shared/ui/forms';
import { InfoPopover } from '~/shared/ui/InfoPopover';
import type { AllocationRule } from '../core/design';
import { stratumWeights } from '../core/design';
import { PRECISION_PRESETS, SAMPLE_FLOOR_RATIONALE } from '../core/guidance';
import type { AreaEstimationPlan, DomainDesign } from '../core/plan';
import { designsOf, planNeedsPilot, precisionCurves, totalPoints } from '../core/plan';
import { ChoiceCard, choiceCardCls, Note, StepHeading, SubHeading } from './Explain';
import { PrecisionCurve } from './PrecisionCurve';
import { formatCount, formatPercent } from './format';

interface Props {
  plan: AreaEstimationPlan;
  update: (patch: Partial<AreaEstimationPlan>) => void;
}

const RULES: { id: AllocationRule; name: string; description: string; theory: string }[] = [
  {
    id: 'neyman',
    name: 'Optimal for the target class',
    description:
      'Concentrates the sample where the target class is most uncertain, giving the smallest confidence interval for it at a given sample size.',
    theory:
      'Neyman allocation: n_i proportional to W_i·S_i, the stratum weight times the stratum standard deviation. It is the exact minimiser of the target class variance for a fixed total sample size, so no other rule beats it on that one estimate - and it is why a stratum the map gets almost always right receives few units while a mixed stratum receives many.',
  },
  {
    id: 'proportional',
    name: 'Proportional to stratum weight',
    description:
      'Best for overall accuracy and for the largest strata, at the cost of the rare ones.',
    theory:
      'Proportional allocation: n_i proportional to W_i alone. Every sampling unit then carries the same weight, which makes the estimator self-weighting and minimises the variance of overall accuracy. Rare strata receive almost nothing, which is what the per-stratum minimum exists to correct.',
  },
  {
    id: 'equal',
    name: 'Equal across strata',
    description:
      'Best when the accuracy of each individual class matters more than any area figure. Inefficient for area estimation.',
    theory:
      "Equal allocation: n_i = n/k. It equalises the precision of each stratum's user's accuracy, which is why accuracy assessments favour it, but it heavily over-samples small strata for area estimation, where a stratum's contribution to the total is weighted by W_i.",
  },
];

/**
 * Sample sizes to evaluate the curve at: from well under the current design to
 * well over it, so the knee is on screen wherever the design happens to sit.
 */
const curveTotals = (requested: number): number[] => {
  const top = Math.max(200, Math.round(requested * 2.5));
  return [...Array.from({ length: 45 }, (_, i) => Math.round((top * (i + 1)) / 45)), requested];
};

export const StepDesign = ({ plan, update }: Props) => {
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
        <StepHeading
          title="Pilot sample"
          technical={
            <p>
              A flat budget per stratum with a proportional split gives every stratum enough units
              to estimate its own user&apos;s accuracy to within roughly ±0.07 at 50 units, which is
              enough to drive the Neyman allocation of the remaining sample size. The pilot units
              remain part of the final stratified sample.
            </p>
          }
        >
          Without a usable accuracy estimate, the campaign starts by measuring the map rather than
          guessing at it. These units are annotated first; once they are done, this page recomputes
          the full design from the accuracies the pilot measured, and the units already annotated
          count towards it.
        </StepHeading>

        {!customPilot ? (
          <button
            type="button"
            onClick={() => setCustomPilot(true)}
            className="text-sm text-neutral-500 hover:text-neutral-700 underline underline-offset-4 cursor-pointer self-start"
            data-testid="uae-customize-pilot"
          >
            Customize the pilot
          </button>
        ) : (
          <div className="flex flex-wrap items-start gap-6">
            <Field
              label="Budget per class"
              hint="What the pilot buys per class, then spread by how much of the map each covers."
              className="w-[15rem]"
            >
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
            <Field
              label="Floor per class"
              hint="No class falls below this, however little of the map it covers."
              className="w-[15rem]"
            >
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
        title="Sample design"
        technical={
          <p>
            Expected precision is √(Σ W<sub>i</sub>² S<sub>i</sub>² / n<sub>i</sub>) divided by the
            expected proportion, the design-stage form of the stratified standard error. It is an
            anticipation under the assumed error matrix, not a guarantee: the interval you finally
            publish is computed from the annotated sampling units.
          </p>
        }
        source="Olofsson et al. (2014), Eq. 10 and Table 7."
      >
        The sample size, and how it is allocated across the strata. Every figure here is editable.
        The precision shown is what this design is expected to deliver{' '}
        <em>under the conjectured accuracies</em> of the previous step; the interval you publish is
        computed from the annotated sampling units and appears on the campaign overview as work
        progresses.
      </StepHeading>

      <section className="space-y-3">
        <SubHeading
          title="Target class"
          technical={
            <p>
              Allocation trades precision between strata. Neyman allocation minimises the variance
              of one estimator, so the objective has to be named before the sample sizes can be
              solved. Choosing a different target later only changes the allocation, never the
              validity of units already collected.
            </p>
          }
          source="Olofsson et al. (2014), Section 5.1.2."
        >
          The class whose area drives the sample size. Every other class is still estimated, and you
          will see the precision each of them reaches. Choose the crop your office publishes and has
          to defend, usually the one with the greatest policy or market consequence. A rare class is
          expensive to pin down: making a 2% class the target costs far more units than a 30% class.
        </SubHeading>
        <Field className="max-w-sm">
          <Select
            value={plan.targetClassId ?? ''}
            onChange={(e) => update({ targetClassId: e.target.value || null, overrides: {} })}
            data-testid="uae-target-class"
          >
            <option value="">Choose a class…</option>
            {plan.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || 'Unnamed class'}
              </option>
            ))}
          </Select>
        </Field>
      </section>

      <section className="space-y-3">
        <SubHeading
          title="Target precision"
          technical={
            <p>
              The target is a coefficient of variation: the standard error of the estimated
              proportion divided by the proportion itself. Sample size follows from Cochran&apos;s
              stratified formula with the target standard error set to CV × p̂. A 95% confidence
              interval is roughly ±1.96 × CV of the estimate.
            </p>
          }
        >
          How much uncertainty you are willing to publish alongside the number, stated as a
          percentage <em>of the number itself</em>. At 5%, an estimate of 1.00 Mha comes with a 95%
          confidence interval of roughly ±0.10 Mha. Tighter targets are costly: halving the interval
          requires roughly four times the sample size.
        </SubHeading>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PRECISION_PRESETS.map((preset) => (
            <ChoiceCard
              key={preset.cv}
              selected={Math.abs(plan.targetCv - preset.cv) < 1e-9}
              onSelect={() => update({ targetCv: preset.cv, overrides: {} })}
              title={preset.title}
              badge={
                <Badge tone={preset.cv <= 0.02 ? 'purple' : 'neutral'}>
                  ±{formatPercent(preset.cv, 0)}
                </Badge>
              }
              testId={`uae-cv-${preset.cv}`}
            >
              {preset.example}
            </ChoiceCard>
          ))}

          <label className={choiceCardCls(isCustom)}>
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium text-neutral-900">Something else</span>
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
                  aria-label="Target precision, percent of the estimate"
                  value={isCustom ? Number((plan.targetCv * 100).toFixed(2)) : ''}
                  onChange={(e) =>
                    update({ targetCv: Number(e.target.value) / 100, overrides: {} })
                  }
                  data-testid="uae-cv-custom"
                />
              </span>
              <span className="text-xs text-neutral-600 leading-snug">
                percent of the estimate. Below 2% the sample size grows very quickly.
              </span>
            </span>
          </label>
        </div>
      </section>

      {hasOverrides && (
        <Note tone="warning">
          <div className="flex items-center justify-between gap-3">
            <span>
              Some sample sizes were edited by hand. The expected precision below reflects your
              numbers, not the computed ones.
            </span>
            <Button size="sm" variant="secondary" onClick={() => update({ overrides: {} })}>
              Reset
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
        {advanced ? 'Hide advanced options' : 'Advanced options'}
      </button>

      {advanced && (
        <section className="space-y-6 border-t border-neutral-100 pt-6">
          <Field
            label={
              <span className="inline-flex items-center gap-1">
                Minimum sample size per stratum
                <InfoPopover>{SAMPLE_FLOOR_RATIONALE}</InfoPopover>
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
            title="How the sample size is allocated across strata"
            technical={
              <p>
                With n<sub>i</sub> = a<sub>i</sub>n, the variance of the stratified estimator is
                (1/n)·Σ(W<sub>i</sub>²S<sub>i</sub>²/a<sub>i</sub>), so the rule is the choice of
                the shares a<sub>i</sub>. Minimising that expression over the shares gives Neyman;
                setting a<sub>i</sub> = W<sub>i</sub> gives proportional; a<sub>i</sub> = 1/k gives
                equal. All three are design-unbiased, and an ineffective allocation costs precision
                rather than correctness.
              </p>
            }
            source="Cochran (1977), Eqs. 5.25 and 5.26; Olofsson et al. (2014), Section 5.1.2."
          >
            All three are design-unbiased. They differ only in which estimate ends up most precise.
          </SubHeading>
          <div className="space-y-1.5">
            {RULES.map((rule) => (
              <label
                key={rule.id}
                className="flex items-start gap-2.5 cursor-pointer rounded p-1.5 hover:bg-neutral-50"
              >
                <input
                  type="radio"
                  name="uae-allocation"
                  className="mt-1 cursor-pointer"
                  checked={plan.allocationRule === rule.id}
                  onChange={() => update({ allocationRule: rule.id, overrides: {} })}
                  data-testid={`uae-rule-${rule.id}`}
                />
                <span>
                  <span className="block text-sm text-neutral-900">{rule.name}</span>
                  <span className="block text-xs text-neutral-500 leading-snug">
                    {rule.description}
                  </span>
                  <span className="mt-0.5 block text-xs text-neutral-400 leading-snug">
                    {rule.theory}
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
  const weights = stratumWeights(design.domain.strata);
  const byId = new Map(design.allocation.map((a) => [a.id, a.n]));
  const meetsTarget = design.precision.cv <= plan.targetCv;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
          <th className="py-2 font-medium">Stratum</th>
          <th className="py-2 font-medium w-28 text-right">Stratum weight</th>
          <th className="py-2 pl-10 font-medium w-32 text-right">Sample size</th>
        </tr>
      </thead>
      <tbody>
        {design.domain.strata.map((stratum, i) => (
          <tr key={stratum.id} className="border-b border-neutral-100">
            <td className="py-2 text-neutral-800">
              {stratum.className}
              {stratum.classId === plan.targetClassId && (
                <Badge tone="brand" className="ml-2">
                  target
                </Badge>
              )}
              {stratum.isNoData && (
                <Badge tone="neutral" className="ml-2">
                  not reported
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
                aria-label={`Sample size for ${stratum.className}`}
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
            <td className="pt-3 text-sm text-neutral-700">Expected for the target class</td>
            <td colSpan={2} className="pt-3 pl-10 text-right">
              <Badge tone={meetsTarget ? 'green' : 'yellow'}>
                ±{formatPercent(design.precision.cv)}
                {meetsTarget ? '' : ` - target is ±${formatPercent(plan.targetCv, 0)}`}
              </Badge>
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
};

const TotalsBar = ({ total, pilot }: { total: number; pilot?: boolean }) => (
  <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
    <span className="text-2xl font-semibold text-neutral-900 tabular-nums">
      {formatCount(total)}
    </span>
    <span className="ml-2 text-sm text-neutral-600">
      {pilot ? 'sampling units in the pilot' : 'sampling units to annotate'}
    </span>
  </div>
);
