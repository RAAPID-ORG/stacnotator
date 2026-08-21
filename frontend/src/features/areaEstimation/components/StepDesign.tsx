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

const RULES: { id: AllocationRule; name: string; description: string }[] = [
  {
    id: 'neyman',
    name: 'Optimal for the target class',
    description:
      'Neyman allocation. Puts points where the target class is most uncertain, giving the smallest confidence interval for it at a given total.',
  },
  {
    id: 'proportional',
    name: 'By size of each class',
    description:
      'Proportional allocation. Best for the overall accuracy of the map and for the largest classes, at the cost of the rare ones.',
  },
  {
    id: 'equal',
    name: 'The same for every class',
    description:
      'Equal allocation. Best when the accuracy of each individual class matters more than any area figure. Wasteful for area estimation.',
  },
];

/**
 * Sample sizes to evaluate the curve at: from well under the current design to
 * well over it, so the knee is on screen wherever the design happens to sit.
 */
const curveTotals = (current: number): number[] => {
  const top = Math.max(200, Math.round(current * 2.5));
  return [...Array.from({ length: 45 }, (_, i) => Math.round((top * (i + 1)) / 45)), current];
};

/** Rough planning figure: how fast an interpreter gets through sample points. */
const POINTS_PER_HOUR = 30;

export const StepDesign = ({ plan, update }: Props) => {
  const [advanced, setAdvanced] = useState(false);
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
              A flat budget per stratum with a proportional split gives every stratum enough points
              to estimate its own user&apos;s accuracy to within roughly ±0.07 at 50 points, which
              is enough to drive the Neyman allocation of the remaining sample. The pilot points
              remain part of the final stratified sample.
            </p>
          }
        >
          Without a usable prior, the campaign starts by measuring the map rather than guessing at
          it. These points are annotated first; when they are done, this page recomputes the full
          design from what the pilot found, and the points already annotated count towards it.
        </StepHeading>

        <Field
          label="Points per class in the pilot"
          hint="50 is the usual choice. Fewer than 30 will not measure the map well enough to plan on."
          className="max-w-[14rem]"
        >
          <Input
            type="number"
            size="sm"
            min={10}
            max={500}
            step={10}
            value={plan.pilotPerStratum}
            onChange={(e) => update({ pilotPerStratum: Number(e.target.value), overrides: {} })}
            data-testid="uae-pilot-per-stratum"
          />
        </Field>

        {designs.map((design) => (
          <DesignTable
            key={design.domain.id}
            plan={plan}
            design={design}
            showPrecision={false}
            showMultiple={designs.length > 1}
            onSetPoints={setPoints}
          />
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
            publish comes from the annotated points.
          </p>
        }
        source="Olofsson et al. (2014), Eq. 10 and Table 7."
      >
        How many points to annotate, and where they go. Everything here is editable. The precision
        shown is what this design should deliver <em>if the map behaves as you said it would</em> on
        the previous step; the real interval is computed from the annotated points and appears on
        the campaign overview as work progresses.
      </StepHeading>

      <section className="space-y-3">
        <SubHeading
          title="Target class"
          technical={
            <p>
              Allocation trades precision between strata. Neyman allocation minimises the variance
              of one estimator, so the objective has to be named before the sample sizes can be
              solved. Choosing a different target later only changes the allocation, never the
              validity of points already collected.
            </p>
          }
          source="Olofsson et al. (2014), Section 5.1.2."
        >
          The class whose area drives the sample size; the others are still estimated, and you will
          see how precise each of them comes out. Pick the crop your ministry publishes and defends,
          usually the one with the biggest policy or market consequence. A rare class is expensive
          to pin down, so making a 2% class the target costs far more points than a 30% class.
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
          confidence interval of roughly ±0.10 Mha. Tighter targets cost points steeply: halving the
          interval needs about four times the sample.
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
                <Input
                  type="number"
                  size="sm"
                  min={0.5}
                  max={50}
                  step={0.5}
                  aria-label="Target precision, percent of the estimate"
                  value={Number((plan.targetCv * 100).toFixed(2))}
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

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-4">
          <Field
            label={
              <span className="inline-flex items-center gap-1">
                Minimum points per class
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
              step={10}
              value={plan.sampleFloor}
              onChange={(e) => update({ sampleFloor: Number(e.target.value), overrides: {} })}
              data-testid="uae-sample-floor"
            />
          </Field>
          <Field label="Target precision" className="w-[10rem]">
            <Input size="sm" readOnly value={`±${formatPercent(plan.targetCv, 0)}`} />
          </Field>
          <button
            type="button"
            onClick={() => setAdvanced(!advanced)}
            className="h-9 text-sm text-neutral-500 hover:text-neutral-700 underline underline-offset-4 cursor-pointer"
          >
            {advanced ? 'Hide how points are spread' : 'Change how points are spread'}
          </button>
        </div>

        {advanced && (
          <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <SubHeading title="Allocation rule">
              All three give unbiased estimates. They differ only in which number ends up most
              precise.
            </SubHeading>
            <div className="space-y-1.5">
              {RULES.map((rule) => (
                <label
                  key={rule.id}
                  className="flex items-start gap-2.5 cursor-pointer rounded p-1.5 hover:bg-white"
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
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
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
        <section key={`curve-${design.domain.id}`} className="space-y-2">
          <SubHeading
            title={
              designs.length > 1
                ? `How precision grows: ${design.domain.name}`
                : 'How precision grows'
            }
            technical={
              <p>
                Each curve is √(Σ W<sub>i</sub>² S<sub>i</sub>² / n<sub>i</sub>) over the expected
                proportion of that class, evaluated at the allocation the current rule and floor
                produce for every total. Precision improves with the square root of the sample,
                which is why the curves flatten; hand-edited sample sizes are left out, since the
                curve describes the rule rather than one point chosen off it.
              </p>
            }
            source="Olofsson et al. (2014), Eq. 10."
          >
            What each class&apos;s confidence interval would be at any total sample size. Hover to
            read off a size; the marker is where this design sits.
          </SubHeading>
          <PrecisionCurve
            series={precisionCurves(plan, design.domain, curveTotals(design.total))}
            currentTotal={design.total}
            targetCv={plan.targetCv}
            targetClassId={plan.targetClassId}
          />
        </section>
      ))}

      {designs.map((design) => (
        <DesignTable
          key={design.domain.id}
          plan={plan}
          design={design}
          showPrecision
          showMultiple={designs.length > 1}
          onSetPoints={setPoints}
        />
      ))}

      <TotalsBar total={total} />
    </div>
  );
};

const DesignTable = ({
  plan,
  design,
  showPrecision,
  showMultiple,
  onSetPoints,
}: {
  plan: AreaEstimationPlan;
  design: DomainDesign;
  showPrecision: boolean;
  showMultiple: boolean;
  onSetPoints: (stratumId: string, n: number) => void;
}) => {
  const weights = stratumWeights(design.domain.strata);
  const byId = new Map(design.allocation.map((a) => [a.id, a.n]));
  const precisionByClass = new Map(design.perClass.map((p) => [p.classId, p.precision]));
  const meetsTarget = design.precision.cv <= plan.targetCv;

  return (
    <section className="space-y-2">
      {showMultiple && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-neutral-900">{design.domain.name}</h3>
          <span className="text-xs text-neutral-500 tabular-nums">
            {formatCount(design.total)} points
          </span>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
            <th className="py-2 font-medium">Class</th>
            <th className="py-2 font-medium w-28 text-right">Share of map</th>
            {showPrecision && <th className="py-2 font-medium w-28 text-right">Map right</th>}
            <th className="py-2 font-medium w-32 text-right">Points</th>
            {showPrecision && <th className="py-2 font-medium w-32 text-right">Expected ±</th>}
          </tr>
        </thead>
        <tbody>
          {design.domain.strata.map((stratum, i) => {
            const classPrecision = precisionByClass.get(stratum.classId);
            return (
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
                {showPrecision && (
                  <td className="py-2 text-right text-neutral-500 tabular-nums">
                    {stratum.isNoData
                      ? '—'
                      : formatPercent(plan.correctShares[stratum.classId] ?? 0.85, 0)}
                  </td>
                )}
                <td className="py-2">
                  <Input
                    type="number"
                    size="sm"
                    min={0}
                    className="w-24 text-right tabular-nums"
                    aria-label={`Sample points for ${stratum.className}`}
                    value={byId.get(stratum.id) ?? 0}
                    onChange={(e) => onSetPoints(stratum.id, Number(e.target.value))}
                  />
                </td>
                {showPrecision && (
                  <td className="py-2 text-right tabular-nums text-neutral-600">
                    {stratum.isNoData || !classPrecision ? '—' : formatPercent(classPrecision.cv)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        {showPrecision && (
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-3 text-sm text-neutral-700">
                Expected precision for the target class
              </td>
              <td colSpan={2} className="pt-3 text-right">
                <Badge tone={meetsTarget ? 'green' : 'yellow'}>
                  ±{formatPercent(design.precision.cv)}
                  {meetsTarget ? '' : ` -target is ±${formatPercent(plan.targetCv, 0)}`}
                </Badge>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </section>
  );
};

const TotalsBar = ({ total, pilot }: { total: number; pilot?: boolean }) => (
  <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
    <div>
      <span className="text-2xl font-semibold text-neutral-900 tabular-nums">
        {formatCount(total)}
      </span>
      <span className="ml-2 text-sm text-neutral-600">
        {pilot ? 'points in the pilot' : 'points to annotate'}
      </span>
    </div>
    <span className="text-xs text-neutral-500">
      Roughly {Math.max(1, Math.round(total / POINTS_PER_HOUR))} hours of interpretation at{' '}
      {POINTS_PER_HOUR} points per hour.
    </span>
  </div>
);
