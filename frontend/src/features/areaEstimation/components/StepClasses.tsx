import { useState } from 'react';
import { Button, IconButton, Input, Select } from '~/shared/ui/forms';
import { IconPlus, IconTrash } from '~/shared/ui/Icons';
import type { AreaEstimationPlan, ReportingClass } from '../core/plan';
import { NO_DATA_CLASS_ID, pixelsFor, unassignedValues } from '../core/plan';
import { ChoiceCard, expandLinkCls, Note, StepHeading, SubHeading } from './Explain';
import { formatPercent } from './format';

interface Props {
  plan: AreaEstimationPlan;
  update: (patch: Partial<AreaEstimationPlan>) => void;
}

export const StepClasses = ({ plan, update }: Props) => {
  const [advanced, setAdvanced] = useState(false);
  const unassigned = unassignedValues(plan);
  const totalPixels = pixelsFor(
    plan,
    plan.values.filter((v) => !plan.noDataValues.includes(v.value)).map((v) => v.value)
  );

  const setClasses = (classes: ReportingClass[]) => {
    const ids = new Set(classes.map((c) => c.id));
    update({
      classes,
      targetClassId: plan.targetClassId && ids.has(plan.targetClassId) ? plan.targetClassId : null,
      overrides: {},
    });
  };

  /** Move a map value into a class, out of whichever one currently holds it. */
  const assign = (value: number, toClassId: string | null) => {
    if (toClassId === NO_DATA_CLASS_ID) {
      update({
        noDataValues: [...plan.noDataValues, value],
        classes: plan.classes.map((c) => ({ ...c, values: c.values.filter((v) => v !== value) })),
        overrides: {},
      });
      return;
    }
    const stripped = plan.classes.map((c) => ({
      ...c,
      values: c.values.filter((v) => v !== value),
    }));
    update({
      noDataValues: plan.noDataValues.filter((v) => v !== value),
      classes: stripped.map((c) =>
        c.id === toClassId ? { ...c, values: [...c.values, value] } : c
      ),
      overrides: {},
    });
  };

  const classOf = (value: number) =>
    plan.noDataValues.includes(value)
      ? NO_DATA_CLASS_ID
      : (plan.classes.find((c) => c.values.includes(value))?.id ?? '');

  const renameClass = (id: string, name: string) =>
    setClasses(plan.classes.map((c) => (c.id === id ? { ...c, name } : c)));

  const removeClass = (id: string) => setClasses(plan.classes.filter((c) => c.id !== id));

  const nodataSection = (
    <section className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
      <SubHeading
        title="Nodata pixels"
        technical={
          <p>
            Excluding nodata removes it from the target population: the stratum weights are
            renormalised over what remains and the reported total area shrinks accordingly. Keeping
            it as a stratum leaves it in the population and allows sampling units inside it to carry
            a real reference label, which is what recovers area the map failed to assign. Nodata is
            never a reporting class either way.
          </p>
        }
      >
        Nodata pixels are not a class you report on, but they are still ground. The choice defines
        the target population, and therefore what your published total covers.
      </SubHeading>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ChoiceCard
          selected={plan.noDataHandling === 'exclude'}
          onSelect={() => update({ noDataHandling: 'exclude', overrides: {} })}
          title="Exclude them from the target population"
          testId="uae-nodata-exclude"
        >
          Correct when the nodata pixels lie outside what you report on: sea, another country,
          permanent cloud. Your published total then covers the mapped part only.
        </ChoiceCard>
        <ChoiceCard
          selected={plan.noDataHandling === 'stratum'}
          onSelect={() => update({ noDataHandling: 'stratum', overrides: {} })}
          title="Keep them as their own stratum"
          testId="uae-nodata-stratum"
        >
          Correct when they are land inside your reporting area that the map simply failed on.
          Sampling units fall there too, so crop the map missed still enters your total.
        </ChoiceCard>
      </div>
    </section>
  );

  return (
    <div className="space-y-8">
      <StepHeading
        title="Reporting classes and strata"
        technical={
          <>
            <p>
              Each reporting class becomes one stratum. Aggregating map classes before sampling is
              usually preferable to reporting them separately and summing afterwards: a merged
              stratum carries a single sample size that can be driven to the precision required,
              whereas thin strata each need their own minimum.
            </p>
            <p className="mt-1.5">
              Aggregation introduces no bias. The reference labels are recorded against this same
              class list, so the estimated error matrix stays square and the stratum weights
              continue to sum to one.
            </p>
          </>
        }
        source="Olofsson et al. (2014), Section 2.1.1 on aggregating map classes into strata."
      >
        The classes you publish need not be the classes the map produced. If the map separates
        wheat, barley and rye but you report a single <em>winter cereals</em> figure, assign all
        three to one reporting class here. Each reporting class becomes one stratum of the sample
        design, so fewer and larger classes reach a given precision with a smaller sample.
      </StepHeading>

      <section className="space-y-6">
        <div className="space-y-3">
          <SubHeading
            title="Step 1 - Define class names"
            moreLabel="What photointerpretable means."
            technical={
              <>
                <p>
                  An annotator looking at the imagery available at a sampling unit has to be able to
                  decide reliably whether that unit is the class. This is a requirement of the
                  response design rather than a preference.
                </p>
                <p className="mt-1.5">
                  The estimator treats the reference classification as correct, so error in it is
                  not averaged away by a larger sample: it propagates directly into the estimated
                  area and the estimated accuracies. It is the one error a probability sample cannot
                  correct for.
                </p>
                <p className="mt-1.5">
                  Where two classes cannot be separated on screen, merge them in step 2 and report
                  the combined class. A coarser class annotators can apply consistently is worth
                  more than a finer one they cannot.
                </p>
              </>
            }
            source="Olofsson et al. (2014), Section 3 on the response design."
          >
            The rows of your published table. Each one becomes a stratum of the sample design, and
            each is a label an annotator will be asked to assign at a sampling unit. Every class
            must therefore be <strong>photointerpretable</strong>.
          </SubHeading>

          <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
            {plan.classes.map((cls) => (
              <li key={cls.id} className="py-2.5 flex items-center gap-3">
                <Input
                  size="sm"
                  value={cls.name}
                  placeholder="Class name"
                  invalid={!cls.name.trim()}
                  className="max-w-xs"
                  aria-label="Reporting class name"
                  onChange={(e) => renameClass(cls.id, e.target.value)}
                />
                <span className="flex-1" />
                <span className="text-xs text-neutral-500 tabular-nums">
                  {cls.values.length === 0
                    ? 'nothing assigned yet'
                    : formatPercent(
                        totalPixels > 0 ? pixelsFor(plan, cls.values) / totalPixels : 0
                      )}
                </span>
                <IconButton
                  tone="danger"
                  onClick={() => removeClass(cls.id)}
                  aria-label={`Remove ${cls.name || 'class'}`}
                >
                  <IconTrash className="w-4 h-4" />
                </IconButton>
              </li>
            ))}
          </ul>

          <Button
            size="sm"
            variant="secondary"
            leading={<IconPlus className="w-3.5 h-3.5" />}
            onClick={() =>
              setClasses([...plan.classes, { id: `class-new-${Date.now()}`, name: '', values: [] }])
            }
            data-testid="uae-add-class"
          >
            Add a class
          </Button>
        </div>

        <div className="space-y-3">
          <SubHeading title="Step 2 - Assign classes to strata (merge)">
            Every class the map produces has to be accounted for. Two or more map classes assigned
            to the same reporting class are merged into a single stratum.
          </SubHeading>

          {plan.noDataValues.length > 0 && (
            <>
              <p className="text-xs leading-snug text-neutral-500">
                {plan.noDataHandling === 'exclude'
                  ? 'Pixels marked nodata are excluded from the sample and from the area you publish: no sampling unit falls on them.'
                  : 'Pixels marked nodata are kept as their own stratum, so sampling units fall on them too and ground the map failed to classify still enters your published total.'}{' '}
                <button
                  type="button"
                  onClick={() => setAdvanced(!advanced)}
                  className={expandLinkCls}
                  data-testid="uae-classes-advanced"
                >
                  {advanced ? 'Show less.' : 'Advanced options.'}
                </button>
              </p>

              {advanced && nodataSection}
            </>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
                <th className="py-2 font-medium w-16">Value</th>
                <th className="py-2 font-medium">Map class</th>
                <th className="py-2 pr-6 font-medium w-24 text-right">Stratum weight</th>
                <th className="py-2 font-medium w-64">Assigned to</th>
              </tr>
            </thead>
            <tbody>
              {plan.values.map((value) => {
                const assigned = classOf(value.value);
                const share = totalPixels > 0 ? pixelsFor(plan, [value.value]) / totalPixels : 0;
                return (
                  <tr key={value.value} className="border-b border-neutral-100">
                    <td className="py-2 font-mono text-xs text-neutral-400">{value.value}</td>
                    <td className="py-2 text-neutral-800">{value.label || 'Unnamed'}</td>
                    <td className="py-2 pr-6 text-right text-xs text-neutral-500 tabular-nums">
                      {assigned === NO_DATA_CLASS_ID ? '-' : formatPercent(share)}
                    </td>
                    <td className="py-2">
                      <Select
                        size="sm"
                        value={assigned}
                        invalid={assigned === ''}
                        aria-label={`Stratum for map class ${value.label || value.value}`}
                        onChange={(e) => assign(value.value, e.target.value || null)}
                      >
                        <option value="">Not assigned</option>
                        {plan.classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name || 'Unnamed class'}
                          </option>
                        ))}
                        <option value={NO_DATA_CLASS_ID}>Nodata - not a reporting class</option>
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {unassigned.length > 0 && (
            <Note tone="warning">
              {unassigned.length} map class{unassigned.length === 1 ? ' is' : 'es are'} not assigned
              yet. Every pixel of the reporting area has to fall in exactly one stratum, otherwise
              the stratum weights do not sum to the area you are reporting on.
            </Note>
          )}
        </div>
      </section>
    </div>
  );
};
