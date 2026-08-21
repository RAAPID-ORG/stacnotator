import { Badge } from '~/shared/ui/Badge';
import { Field, Input, Select } from '~/shared/ui/forms';
import { PRECISION_PRESETS } from '../core/guidance';
import { pixelsFor, type AreaEstimationPlan } from '../core/plan';
import { ChoiceCard, StepHeading, SubHeading } from './Explain';
import { formatArea, formatPercent } from './format';

interface Props {
  plan: AreaEstimationPlan;
  update: (patch: Partial<AreaEstimationPlan>) => void;
}

export const StepTarget = ({ plan, update }: Props) => {
  const target = plan.classes.find((c) => c.id === plan.targetClassId);
  const mappedArea =
    target && plan.census && plan.raster
      ? pixelsFor(plan, target.values) * plan.raster.areaPerPixel
      : null;

  return (
    <div className="space-y-8">
      <StepHeading title="The number you care about most">
        A sample cannot be equally precise about everything at once. Say which figure has to be
        right, and how right, and the rest of the design follows from it.
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
        </div>

        <Field
          label="Or set it yourself"
          hint="Percent of the estimate. Below 2% the sample size grows very quickly."
          className="max-w-[12rem]"
        >
          <Input
            type="number"
            size="sm"
            min={0.5}
            max={50}
            step={0.5}
            value={Number((plan.targetCv * 100).toFixed(2))}
            onChange={(e) => update({ targetCv: Number(e.target.value) / 100, overrides: {} })}
            data-testid="uae-cv-custom"
          />
        </Field>

        {target && mappedArea !== null && (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            The map puts <strong>{target.name}</strong> at {formatArea(mappedArea)}. If the sample
            lands near that, a {formatPercent(plan.targetCv, 0)} target means publishing roughly{' '}
            <strong>
              {formatArea(mappedArea)} ± {formatArea(mappedArea * plan.targetCv * 1.96)}
            </strong>{' '}
            at 95% confidence.
            <span className="block mt-1 text-xs text-neutral-500">
              The map&apos;s own figure is shown only as an anchor for the size of the target. It is
              not the estimate and it is not unbiased.
            </span>
          </div>
        )}
      </section>
    </div>
  );
};
