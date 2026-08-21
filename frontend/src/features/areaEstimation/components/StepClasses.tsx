import { Input, Select } from '~/shared/ui/forms';
import { Badge } from '~/shared/ui/Badge';
import type { AreaEstimationPlan, ReportingClass } from '../core/plan';
import { NO_DATA_CLASS_ID, pixelsFor, unassignedValues } from '../core/plan';
import { ChoiceCard, Note, StepHeading, SubHeading } from './Explain';
import { formatPercent } from './format';

interface Props {
  plan: AreaEstimationPlan;
  update: (patch: Partial<AreaEstimationPlan>) => void;
}

const NEW_CLASS = '__new__';

export const StepClasses = ({ plan, update }: Props) => {
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
    const label = plan.values.find((v) => v.value === value)?.label || `Value ${value}`;
    const stripped = plan.classes.map((c) => ({
      ...c,
      values: c.values.filter((v) => v !== value),
    }));
    const classes =
      toClassId === NEW_CLASS
        ? [...stripped, { id: `class-${value}-${stripped.length}`, name: label, values: [value] }]
        : stripped.map((c) => (c.id === toClassId ? { ...c, values: [...c.values, value] } : c));
    update({
      noDataValues: plan.noDataValues.filter((v) => v !== value),
      classes: classes.filter((c) => c.values.length > 0 || c.id === toClassId),
      targetClassId: plan.targetClassId,
      overrides: {},
    });
  };

  const classOf = (value: number) =>
    plan.noDataValues.includes(value)
      ? NO_DATA_CLASS_ID
      : (plan.classes.find((c) => c.values.includes(value))?.id ?? '');

  const renameClass = (id: string, name: string) =>
    setClasses(plan.classes.map((c) => (c.id === id ? { ...c, name } : c)));

  const merged = plan.classes.filter((c) => c.values.length > 1);

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
        The classes you publish do not have to be the classes the map produced. If your map
        separates wheat, barley and rye but you publish a single <em>winter cereals</em> number,
        send all three to the same class here. Fewer, larger classes need fewer points to reach the
        same precision.
      </StepHeading>

      <section className="space-y-3">
        <SubHeading title="Where each map value is reported">
          Every value from the map goes somewhere. Each starts as its own class; send two to the
          same one to merge them.
        </SubHeading>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
              <th className="py-2 font-medium w-16">Value</th>
              <th className="py-2 font-medium">From the map</th>
              <th className="py-2 pr-6 font-medium w-20 text-right">Share</th>
              <th className="py-2 font-medium w-64">Reported as</th>
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
                      aria-label={`Reporting class for ${value.label || value.value}`}
                      onChange={(e) => assign(value.value, e.target.value || null)}
                    >
                      <option value="">Not assigned</option>
                      {plan.classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || 'Unnamed class'}
                        </option>
                      ))}
                      <option value={NEW_CLASS}>＋ A class of its own</option>
                      <option value={NO_DATA_CLASS_ID}>Nodata - not a class</option>
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {unassigned.length > 0 && (
          <Note tone="warning">
            {unassigned.length} map value{unassigned.length === 1 ? ' is' : 's are'} not reported
            anywhere yet. Every pixel of the study area has to belong somewhere, otherwise the
            stratum weights do not add up to the area you are reporting on.
          </Note>
        )}
      </section>

      {merged.length > 0 && (
        <section className="space-y-3">
          <SubHeading title="Name your merged classes">
            These hold more than one map value, so they need a name of their own.
          </SubHeading>
          <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
            {merged.map((cls) => (
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
                <span className="flex flex-wrap gap-1">
                  {cls.values.map((v) => (
                    <Badge key={v} tone="neutral">
                      {plan.values.find((x) => x.value === v)?.label || v}
                    </Badge>
                  ))}
                </span>
                <span className="flex-1" />
                <span className="text-xs text-neutral-500 tabular-nums">
                  {formatPercent(totalPixels > 0 ? pixelsFor(plan, cls.values) / totalPixels : 0)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
            Nothing is marked as nodata, so the whole map is being reported on.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ChoiceCard
              selected={plan.noDataHandling === 'exclude'}
              onSelect={() => update({ noDataHandling: 'exclude', overrides: {} })}
              title="Leave them out of the study area"
              testId="uae-nodata-exclude"
            >
              Right when the nodata pixels are outside what you report on: sea, another country,
              permanent cloud. Your total then covers the mapped part only.
            </ChoiceCard>
            <ChoiceCard
              selected={plan.noDataHandling === 'stratum'}
              onSelect={() => update({ noDataHandling: 'stratum', overrides: {} })}
              title="Sample them as their own group"
              testId="uae-nodata-stratum"
            >
              Right when they are land inside your country that the map simply failed on. Points
              land there too, so crop that the map missed still reaches your total.
            </ChoiceCard>
          </div>
        )}
      </section>
    </div>
  );
};
