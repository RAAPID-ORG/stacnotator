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
  caution: 'red',
};

const Term = ({ term, children }: { term: string; children: React.ReactNode }) => (
  <div>
    <dt className="inline font-medium text-neutral-900">{term}</dt>{' '}
    <dd className="inline">{children}</dd>
  </div>
);

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
        title="What is already known about this map?"
        technical={
          <>
            <p>
              Sample size planning requires a conjectured error matrix. The stratum standard
              deviations S<sub>i</sub> = √(UA<sub>i</sub>(1 − UA<sub>i</sub>)) are derived from the
              conjectured user&apos;s accuracies, and those standard deviations are what Neyman
              allocation divides the sample size by. A mis-specified conjecture changes only the
              allocation, and an ineffective allocation of sample size to strata does not bias the
              estimators of area or accuracy.
            </p>
            <p className="mt-1.5">
              This is also why the design may be revised mid-campaign: stratified random sampling
              accommodates a change of sample size after collection has begun, provided the strata
              themselves stay fixed.
            </p>
          </>
        }
        source="Olofsson et al. (2014), Sections 2.2 and 5.1.1."
      >
        Allocating the sample across strata requires a conjecture about how accurate the map is. The
        conjecture is used <strong>only</strong> to decide how many sampling units each stratum
        receives. It does not enter the estimator, so an optimistic or pessimistic conjecture widens
        or narrows your confidence interval but cannot bias the area you publish.
      </StepHeading>

      <section className="space-y-3">
        <SubHeading
          title="What counts as knowing how accurate a map is"
          technical={
            <p>
              The error matrix is estimated in units of area proportion, p̂<sub>ij</sub> = W
              <sub>i</sub>(n<sub>ij</sub>/n<sub>i</sub>), not as raw sample counts. This is what
              makes the accuracy measures and the area estimates consistent with each other, and it
              is why the stratum weights W<sub>i</sub> have to come from a full pixel count rather
              than from the sample.
            </p>
          }
          source="Olofsson et al. (2014), Sections 2.2, 4.1 and 4.2; Stehman and Foody (2019), Key issues in rigorous accuracy assessment."
        >
          An accuracy figure is not a property of a classifier. It is an estimate of a population
          quantity, obtained from a probability sample of the mapped area whose units carry a
          reference classification of higher quality than the map. That sample yields an error
          matrix, and the three familiar measures are read off it.
        </SubHeading>

        <dl className="space-y-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-[13px] leading-relaxed text-neutral-700">
          <Term term="User's accuracy (UA).">
            Of the area the map assigns to a class, the proportion that really is that class. Its
            complement is commission error - what the map over-called.
          </Term>
          <Term term="Producer's accuracy (PA).">
            Of the area that really is a class, the proportion the map assigned to it. Its
            complement is omission error - what the map missed.
          </Term>
          <Term term="Overall accuracy (OA).">
            The proportion of the whole mapped area the map classifies correctly. It is dominated by
            the largest classes, so it says little about a rare crop.
          </Term>
        </dl>

        <p className="text-xs leading-snug text-neutral-500">
          Three things do not count, however carefully they were produced: accuracy measured on
          training data, accuracy from a convenience or purposive sample, and a per-class figure
          resting on a handful of units. Each describes the units that happened to be labelled
          rather than the mapped population, and none carries a defensible confidence interval.
        </p>
      </section>

      <section className="space-y-2">
        <SubHeading title="What is the conjecture based on?">
          The stronger the basis, the closer the allocation lands to optimal. Every option here
          produces a valid estimate; they differ in how efficiently the sample is spent.
        </SubHeading>
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
                <span className="mt-2 block leading-relaxed text-neutral-700">{s.rationale}</span>
              )}
            </ChoiceCard>
          ))}
        </div>
      </section>

      {!planNeedsPilot(plan) && (
        <section className="space-y-4">
          <SubHeading
            title="Conjectured user's accuracy of each stratum"
            technical={
              <p>
                Producer&apos;s accuracy cannot be substituted here. PA is a ratio whose denominator
                runs across every stratum, so it is not a property of the stratum being sized and is
                not knowable until the reference labels are in. UA is a within-stratum proportion,
                which is exactly what the stratum standard deviation needs.
              </p>
            }
            source="Olofsson et al. (2014), Section 5.1.1 and Table 6."
          >
            For each stratum: of every 100 pixels the map assigns to it, how many really are that
            class. Both UA and PA are estimated from the finished sample and published beside the
            area; only UA has to be conjectured in advance.
          </SubHeading>

          <p className="text-xs leading-snug text-neutral-500">
            Starting values come from {sourceName}. Revise any stratum you have better information
            about and leave the rest as they are.
          </p>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="py-2 font-medium">Stratum</th>
                <th className="py-2 pr-8 font-medium w-28 text-right">Stratum weight</th>
                <th className="py-2 font-medium w-[22rem]">Conjectured UA, out of 100</th>
              </tr>
            </thead>
            <tbody>
              {plan.classes.map((cls) => {
                const name = cls.name || 'Unnamed class';
                const ua = Math.round((plan.correctShares[cls.id] ?? fallback) * 100);
                const weight = totalPixels > 0 ? pixelsFor(plan, cls.values) / totalPixels : 0;
                return (
                  <tr key={cls.id} className="border-b border-neutral-100">
                    <td className="py-2 pr-4 text-neutral-800">{name}</td>
                    <td className="py-2 pr-8 text-right text-xs text-neutral-500 tabular-nums">
                      {formatPercent(weight)}
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
                          aria-label={`Conjectured user's accuracy for ${name}`}
                        />
                        <span className="w-16 shrink-0">
                          <Input
                            type="number"
                            size="sm"
                            min={1}
                            max={100}
                            step={1}
                            className="text-right tabular-nums"
                            aria-label={`Conjectured user's accuracy for ${name}, percent`}
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

      {planNeedsPilot(plan) && (
        <SubHeading
          title="Starting with a pilot"
          technical={
            <p>
              The pilot is the first phase of a two-phase design. Its units are drawn from the same
              strata by the same protocol, so they remain part of the final stratified sample and
              enter the estimator with the same weights. Only the allocation of the remaining sample
              size is chosen using them, and the choice of allocation does not affect unbiasedness.
            </p>
          }
        >
          The next step plans a pilot rather than a full design. Once the pilot units are annotated,
          this page estimates the map&apos;s accuracies from them and proposes the full sample from
          measured figures instead of conjectured ones. <strong>Pilot units are retained</strong>{' '}
          and count towards the final sample size.
        </SubHeading>
      )}
    </div>
  );
};
