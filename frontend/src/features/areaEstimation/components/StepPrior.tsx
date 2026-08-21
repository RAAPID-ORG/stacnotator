import { Badge, type BadgeTone } from '~/shared/ui/Badge';
import { Input } from '~/shared/ui/forms';
import { PRIOR_SOURCES, priorSource, type PriorFit, type PriorSourceId } from '../core/guidance';
import type { AreaEstimationPlan } from '../core/plan';
import { defaultCorrectShare, planNeedsPilot } from '../core/plan';
import { ChoiceCard, StepHeading, SubHeading } from './Explain';

interface Props {
  plan: AreaEstimationPlan;
  update: (patch: Partial<AreaEstimationPlan>) => void;
}

const FIT_TONE: Record<PriorFit, BadgeTone> = {
  good: 'green',
  fair: 'blue',
  weak: 'yellow',
  rejected: 'red',
};

export const StepPrior = ({ plan, update }: Props) => {
  const source = priorSource(plan.priorSourceId);
  const fallback = defaultCorrectShare(plan);

  const chooseSource = (id: PriorSourceId) =>
    update({ priorSourceId: id, correctShares: {}, overrides: {} });

  const setCorrectShare = (classId: string, percent: number) =>
    update({
      correctShares: {
        ...plan.correctShares,
        [classId]: Math.min(100, Math.max(0, percent)) / 100,
      },
      overrides: {},
    });

  return (
    <div className="space-y-8">
      <StepHeading
        title="What do you already know about this map?"
        technical={
          <>
            <p>
              Sample size planning needs an assumed error matrix: stratum standard deviations S
              <sub>i</sub> = √(p<sub>i</sub>(1 − p<sub>i</sub>)) come from the assumed user&apos;s
              accuracies. A mis-specified prior changes only the allocation, and an ineffective
              allocation of sample size to strata does not bias the estimators of accuracy or area.
            </p>
            <p className="mt-1.5">
              This is why the design can be revised mid-campaign: stratified random sampling
              accommodates changing sample size after collection has begun, provided the strata
              themselves stay fixed.
            </p>
          </>
        }
        source="Olofsson et al. (2014), Sections 2.2 and 5.1.1."
      >
        To decide how many points each group needs, the tool needs a rough idea of how often the map
        is right. That guess is only used to spread the points sensibly; it is <strong>not</strong>{' '}
        used to compute your published area, so an optimistic or pessimistic guess impacts only your
        confidence interval, but does not add a bias to your results.
      </StepHeading>

      <section className="space-y-2">
        <SubHeading title="Where does your knowledge come from?" />
        <div className="grid grid-cols-1 gap-2">
          {PRIOR_SOURCES.map((s) => (
            <ChoiceCard
              key={s.id}
              selected={plan.priorSourceId === s.id}
              onSelect={() => chooseSource(s.id)}
              title={s.title}
              badge={<Badge tone={FIT_TONE[s.fit]}>{s.fitLabel}</Badge>}
              testId={`uae-prior-${s.id}`}
            >
              {s.summary}
              {plan.priorSourceId === s.id && (
                <span className="mt-2 block leading-relaxed text-neutral-700">
                  {s.rationale}
                  {s.fit === 'rejected' && (
                    <span className="mt-1.5 block">
                      Pick another source above, or choose <em>Nothing reliable yet</em> and the
                      campaign will start with a small pilot that measures the accuracy instead of
                      assuming it.
                    </span>
                  )}
                </span>
              )}
            </ChoiceCard>
          ))}
        </div>
      </section>

      {!planNeedsPilot(plan) && (
        <section className="space-y-3">
          <SubHeading title="How often is the map right?">
            For each class: out of 100 pixels the map calls this class, how many really are it?
          </SubHeading>
          <p className="text-xs text-neutral-500 leading-snug">
            Starting values come from a {source.title.toLowerCase()}. Change any you have better
            information about; leave the rest.
          </p>
          <table className="w-full text-sm max-w-lg">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
                <th className="py-2 font-medium">Class</th>
                <th className="py-2 font-medium w-40 text-right">Really this class</th>
              </tr>
            </thead>
            <tbody>
              {plan.classes.map((cls) => (
                <tr key={cls.id} className="border-b border-neutral-100">
                  <td className="py-2 text-neutral-800">{cls.name || 'Unnamed class'}</td>
                  <td className="py-2">
                    <div className="flex items-center justify-end gap-2">
                      <Input
                        type="number"
                        size="sm"
                        min={1}
                        max={100}
                        step={1}
                        className="w-20 text-right"
                        aria-label={`Share of ${cls.name} that is really ${cls.name}`}
                        value={Math.round((plan.correctShares[cls.id] ?? fallback) * 100)}
                        onChange={(e) => setCorrectShare(cls.id, Number(e.target.value))}
                      />
                      <span className="text-xs text-neutral-500">out of 100</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {plan.priorSourceId === 'none' && (
        <SubHeading
          title="Starting with a pilot"
          technical={
            <p>
              The pilot is the first phase of a two-phase design. Its points are drawn from the same
              strata by the same protocol, so they stay part of the final stratified sample and
              enter the estimator with the same weights. Only the allocation of the remaining points
              is chosen using them, and allocation choice does not affect unbiasedness.
            </p>
          }
        >
          The next step will plan a small pilot instead of a full design. Once those points are
          annotated the tool measures how accurate the map actually is and proposes the full sample
          from real numbers. <strong>Pilot points are kept</strong> and count towards the final
          total.
        </SubHeading>
      )}
    </div>
  );
};
