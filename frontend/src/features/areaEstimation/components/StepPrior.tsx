import { Badge, type BadgeTone } from '~/shared/ui/Badge';
import { Input } from '~/shared/ui/forms';
import { PRIOR_SOURCES, priorSource, type PriorFit, type PriorSourceId } from '../core/guidance';
import type { AreaEstimationPlan } from '../core/plan';
import { defaultCorrectShare, pixelsFor, planNeedsPilot } from '../core/plan';
import { ChoiceCard, StepHeading, SubHeading } from './Explain';
import { formatPercent } from './format';

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
  // Mid-sentence, so the title keeps its own article but loses its capital.
  const sourceName = source.title.charAt(0).toLowerCase() + source.title.slice(1);
  const fallback = defaultCorrectShare(plan);
  const totalPixels = pixelsFor(
    plan,
    plan.values.filter((v) => !plan.noDataValues.includes(v.value)).map((v) => v.value)
  );

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
        <section className="space-y-4">
          <SubHeading
            title="How often is the map right?"
            technical={
              <p>
                The number asked for is each stratum&apos;s user&apos;s accuracy. The stratum
                standard deviations follow from it as S<sub>i</sub> = √(UA<sub>i</sub>(1 − UA
                <sub>i</sub>)), and those are what Neyman allocation divides the sample by.
                Producer&apos;s accuracy cannot stand in for it: PA is a ratio across strata rather
                than a property of one, so it is only knowable once the points are in.
              </p>
            }
            source="Olofsson et al. (2014), Section 5.1.1 and Table 6."
          >
            For each class: out of 100 pixels the map calls that class, how many really are it. That
            is the class&apos;s <strong>user&apos;s accuracy (UA)</strong>. Its counterpart,{' '}
            <strong>producer&apos;s accuracy (PA)</strong> - out of 100 pixels that really are the
            class, how many the map found - is not something you have to guess here: the annotated
            points measure both, and both are published beside the area.
          </SubHeading>

          <p className="text-xs text-neutral-500 leading-snug">
            Starting values come from {sourceName}. Change any you have better information about;
            leave the rest.
          </p>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
                <th className="py-2 font-medium">Class</th>
                <th className="py-2 pr-8 font-medium w-28 text-right">Map share</th>
                <th className="py-2 font-medium w-[22rem]">Expected UA, out of 100</th>
              </tr>
            </thead>
            <tbody>
              {plan.classes.map((cls) => {
                const name = cls.name || 'Unnamed class';
                const ua = Math.round((plan.correctShares[cls.id] ?? fallback) * 100);
                const share = totalPixels > 0 ? pixelsFor(plan, cls.values) / totalPixels : 0;
                return (
                  <tr key={cls.id} className="border-b border-neutral-100">
                    <td className="py-2 pr-4 text-neutral-800">{name}</td>
                    <td className="py-2 pr-8 text-right text-xs text-neutral-500 tabular-nums">
                      {formatPercent(share)}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={1}
                          max={100}
                          step={1}
                          value={ua}
                          onChange={(e) => setCorrectShare(cls.id, Number(e.target.value))}
                          className="h-1.5 flex-1 cursor-pointer accent-brand-600"
                          aria-label={`Expected user's accuracy for ${name}`}
                        />
                        <span className="w-16 shrink-0">
                          <Input
                            type="number"
                            size="sm"
                            min={1}
                            max={100}
                            step={1}
                            className="text-right tabular-nums"
                            aria-label={`Expected user's accuracy for ${name}, percent`}
                            value={ua}
                            onChange={(e) => setCorrectShare(cls.id, Number(e.target.value))}
                          />
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
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
