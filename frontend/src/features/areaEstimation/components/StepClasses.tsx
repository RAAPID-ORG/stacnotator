import { Button, IconButton, Input, Select } from '~/shared/ui/forms';
import { IconClose, IconPlus, IconTrash } from '~/shared/ui/Icons';
import type { AreaEstimationPlan, ReportingClass } from '../core/plan';
import { oneClassPerValue, pixelsFor, unassignedValues } from '../core/plan';
import { ChoiceCard, Note, StepHeading, SubHeading } from './Explain';
import { formatPixels } from './format';

interface Props {
  plan: AreaEstimationPlan;
  update: (patch: Partial<AreaEstimationPlan>) => void;
}

export const StepClasses = ({ plan, update }: Props) => {
  const unassigned = unassignedValues(plan);
  const labelOf = (value: number) =>
    plan.values.find((v) => v.value === value)?.label || `Value ${value}`;

  const setClasses = (classes: ReportingClass[]) => {
    const ids = new Set(classes.map((c) => c.id));
    update({
      classes,
      targetClassId: plan.targetClassId && ids.has(plan.targetClassId) ? plan.targetClassId : null,
      overrides: {},
    });
  };

  const renameClass = (id: string, name: string) =>
    setClasses(plan.classes.map((c) => (c.id === id ? { ...c, name } : c)));

  const removeClass = (id: string) => setClasses(plan.classes.filter((c) => c.id !== id));

  const addClass = () =>
    setClasses([...plan.classes, { id: `class-new-${Date.now()}`, name: '', values: [] }]);

  const moveValue = (value: number, toClassId: string | null) =>
    setClasses(
      plan.classes.map((c) => {
        const without = c.values.filter((v) => v !== value);
        return c.id === toClassId
          ? { ...c, values: [...without, value] }
          : { ...c, values: without };
      })
    );

  return (
    <div className="space-y-8">
      <StepHeading
        title="What you want to report on"
        technical={
          <>
            <p>
              Each reporting class becomes one stratum. Merging map classes before sampling is
              usually better than reporting them separately and adding the results afterwards: a
              merged stratum carries a single sample size that can be pushed to the precision you
              need, whereas separate thin strata each need their own floor.
            </p>
            <p className="mt-1.5">
              Grouping does not bias anything. The reference labels annotators give are recorded
              against the same class list, so the estimated error matrix stays square.
            </p>
          </>
        }
        source="Olofsson et al. (2014), Section 2.1.1 on aggregating classes into strata."
      >
        The classes you publish your statics on do not necesarrily have to be the classes the map
        produced. Group them here. For example, if your map separates winter wheat, barley and rye
        but you publish a single <em>winter cereals</em> number, merge them into one class here.
        Fewer, larger classes need fewer sample points to reach the same precision.
      </StepHeading>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <SubHeading title="Reporting classes">
            The final classes that accuracies will be reported for. Often merged from multiple map
            classes.
          </SubHeading>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setClasses(oneClassPerValue(plan))}
            >
              Reset to one per value
            </Button>
            <Button size="sm" leading={<IconPlus className="w-3.5 h-3.5" />} onClick={addClass}>
              New class
            </Button>
          </div>
        </div>

        {plan.classes.length === 0 ? (
          <p className="text-xs text-neutral-400 italic">No reporting classes yet.</p>
        ) : (
          <ul className="space-y-2">
            {plan.classes.map((cls) => (
              <li key={cls.id} className="border border-neutral-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <Input
                    size="sm"
                    value={cls.name}
                    placeholder="Class name, for example Winter cereals"
                    onChange={(e) => renameClass(cls.id, e.target.value)}
                    className="max-w-sm"
                    invalid={!cls.name.trim()}
                    aria-label="Reporting class name"
                  />
                  <span className="text-xs text-neutral-500 tabular-nums">
                    {plan.census ? `${formatPixels(pixelsFor(plan, cls.values))} px` : ''}
                  </span>
                  <span className="flex-1" />
                  <IconButton
                    tone="danger"
                    onClick={() => removeClass(cls.id)}
                    aria-label={`Remove ${cls.name || 'class'}`}
                  >
                    <IconTrash className="w-4 h-4" />
                  </IconButton>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {cls.values.length === 0 && (
                    <span className="text-[11px] text-red-600">Add at least one map value.</span>
                  )}
                  {cls.values.map((value) => (
                    <span
                      key={value}
                      className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full border border-neutral-200 bg-neutral-50 text-[11px] text-neutral-700"
                    >
                      <span className="font-mono text-neutral-400">{value}</span>
                      {labelOf(value)}
                      <IconButton
                        onClick={() => moveValue(value, null)}
                        aria-label={`Remove ${labelOf(value)} from ${cls.name}`}
                      >
                        <IconClose className="w-3 h-3" />
                      </IconButton>
                    </span>
                  ))}
                  {unassigned.length > 0 && (
                    <Select
                      size="sm"
                      value=""
                      className="w-44"
                      aria-label={`Add a map value to ${cls.name}`}
                      onChange={(e) => e.target.value && moveValue(Number(e.target.value), cls.id)}
                    >
                      <option value="">Add a value…</option>
                      {unassigned.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.value} -{v.label || 'unnamed'}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {unassigned.length > 0 && (
          <Note tone="warning">
            {unassigned.length} map value{unassigned.length === 1 ? ' is' : 's are'} not in any
            class yet: {unassigned.map((v) => v.label || v.value).join(', ')}. Every pixel of the
            study area has to belong somewhere, otherwise the stratum weights do not add up to the
            area you are reporting on.
          </Note>
        )}
      </section>

      <section className="space-y-3">
        <SubHeading
          title="Nodata pixels"
          technical={
            <p>
              Excluding a value removes it from the population: the stratum weights are renormalised
              over what remains and the reported total area shrinks accordingly. Keeping it as a
              stratum leaves it in the population and lets sample points inside it carry a real
              class label, which is what recovers the crop area the map missed. Nodata is never a
              reporting class either way, because nobody wants to publish the area of a gap in their
              own map.
            </p>
          }
        >
          Nodata pixels are not a class you report on, but they are still ground. What you do with
          them changes what your published total covers.
        </SubHeading>

        {plan.noDataValues.length === 0 ? (
          <p className="text-xs text-neutral-500">
            Nothing was marked as nodata, so the whole map is being reported on.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <ChoiceCard
                selected={plan.noDataHandling === 'exclude'}
                onSelect={() => update({ noDataHandling: 'exclude', overrides: {} })}
                title="Leave them out of the study area"
                testId="uae-nodata-exclude"
              >
                Right when the nodata pixels are outside what you report on - i.e sea, outside of
                your area of interest etc.
              </ChoiceCard>
              <ChoiceCard
                selected={plan.noDataHandling === 'stratum'}
                onSelect={() => update({ noDataHandling: 'stratum', overrides: {} })}
                title="Sample them as their own group"
                testId="uae-nodata-stratum"
              >
                Right when they are land inside your country that the map simply failed on.
              </ChoiceCard>
            </div>
          </>
        )}
      </section>
    </div>
  );
};
