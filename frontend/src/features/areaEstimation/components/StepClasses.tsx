import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button, IconButton, Input, Select } from '~/shared/ui/forms';
import { IconPlus, IconTrash } from '~/shared/ui/Icons';
import type { AreaEstimationPlan, ReportingClass } from '../core/plan';
import { NO_DATA_CLASS_ID, pixelsFor, unassignedValues } from '../core/plan';
import { ChoiceCard, expandLinkCls, Note, RICH_TEXT, StepHeading, SubHeading } from './Explain';
import { formatPercent } from './format';

interface Props {
  plan: AreaEstimationPlan;
  update: (patch: Partial<AreaEstimationPlan>) => void;
}

export const StepClasses = ({ plan, update }: Props) => {
  const { t } = useTranslation('areaEstimation');
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
        title={t('classes.nodataTitle')}
        technical={<p>{t('classes.nodataTechnical')}</p>}
      >
        {t('classes.nodataIntro')}
      </SubHeading>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ChoiceCard
          selected={plan.noDataHandling === 'exclude'}
          onSelect={() => update({ noDataHandling: 'exclude', overrides: {} })}
          title={t('classes.exclude')}
          testId="uae-nodata-exclude"
        >
          {t('classes.excludeHint')}
        </ChoiceCard>
        <ChoiceCard
          selected={plan.noDataHandling === 'stratum'}
          onSelect={() => update({ noDataHandling: 'stratum', overrides: {} })}
          title={t('classes.keep')}
          testId="uae-nodata-stratum"
        >
          {t('classes.keepHint')}
        </ChoiceCard>
      </div>
    </section>
  );

  return (
    <div className="space-y-8">
      <StepHeading
        title={t('classes.title')}
        technical={
          <>
            <p>{t('classes.technical1')}</p>
            <p className="mt-1.5">{t('classes.technical2')}</p>
          </>
        }
        source={t('classes.source')}
      >
        <Trans t={t} i18nKey="classes.intro" components={RICH_TEXT} />
      </StepHeading>

      <section className="space-y-6">
        <div className="space-y-3">
          <SubHeading
            title={t('classes.defineTitle')}
            moreLabel={t('classes.defineMore')}
            technical={
              <>
                <p>{t('classes.defineTechnical1')}</p>
                <p className="mt-1.5">{t('classes.defineTechnical2')}</p>
                <p className="mt-1.5">{t('classes.defineTechnical3')}</p>
              </>
            }
            source={t('classes.defineSource')}
          >
            <Trans t={t} i18nKey="classes.defineIntro" components={RICH_TEXT} />
          </SubHeading>

          <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
            {plan.classes.map((cls) => (
              <li key={cls.id} className="py-2.5 flex items-center gap-3">
                <Input
                  size="sm"
                  value={cls.name}
                  placeholder={t('classes.classPlaceholder')}
                  invalid={!cls.name.trim()}
                  className="max-w-xs"
                  aria-label={t('classes.classAria')}
                  onChange={(e) => renameClass(cls.id, e.target.value)}
                />
                <span className="flex-1" />
                <span className="text-xs text-neutral-500 tabular-nums">
                  {cls.values.length === 0
                    ? t('classes.nothingAssigned')
                    : formatPercent(
                        totalPixels > 0 ? pixelsFor(plan, cls.values) / totalPixels : 0
                      )}
                </span>
                <IconButton
                  tone="danger"
                  onClick={() => removeClass(cls.id)}
                  aria-label={
                    cls.name
                      ? t('classes.removeClass', { name: cls.name })
                      : t('classes.removeUnnamedClass')
                  }
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
            {t('classes.addClass')}
          </Button>
        </div>

        <div className="space-y-3">
          <SubHeading title={t('classes.assignTitle')}>{t('classes.assignIntro')}</SubHeading>

          {plan.noDataValues.length > 0 && (
            <>
              <p className="text-xs leading-snug text-neutral-500">
                {plan.noDataHandling === 'exclude'
                  ? t('classes.nodataExcluded')
                  : t('classes.nodataKept')}{' '}
                <button
                  type="button"
                  onClick={() => setAdvanced(!advanced)}
                  className={expandLinkCls}
                  data-testid="uae-classes-advanced"
                >
                  {advanced ? t('showLessDot') : t('classes.advancedOptions')}
                </button>
              </p>

              {advanced && nodataSection}
            </>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
                <th className="py-2 font-medium w-16">{t('table.value')}</th>
                <th className="py-2 font-medium">{t('classes.mapClass')}</th>
                <th className="py-2 pr-6 font-medium w-24 text-right">
                  {t('table.stratumWeight')}
                </th>
                <th className="py-2 font-medium w-64">{t('classes.assignedTo')}</th>
              </tr>
            </thead>
            <tbody>
              {plan.values.map((value) => {
                const assigned = classOf(value.value);
                const share = totalPixels > 0 ? pixelsFor(plan, [value.value]) / totalPixels : 0;
                return (
                  <tr key={value.value} className="border-b border-neutral-100">
                    <td className="py-2 font-mono text-xs text-neutral-400">{value.value}</td>
                    <td className="py-2 text-neutral-800">{value.label || t('classes.unnamed')}</td>
                    <td className="py-2 pr-6 text-right text-xs text-neutral-500 tabular-nums">
                      {assigned === NO_DATA_CLASS_ID ? '-' : formatPercent(share)}
                    </td>
                    <td className="py-2">
                      <Select
                        size="sm"
                        value={assigned}
                        invalid={assigned === ''}
                        aria-label={t('classes.stratumAria', { name: value.label || value.value })}
                        onChange={(e) => assign(value.value, e.target.value || null)}
                      >
                        <option value="">{t('classes.notAssigned')}</option>
                        {plan.classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name || t('unnamedClass')}
                          </option>
                        ))}
                        <option value={NO_DATA_CLASS_ID}>{t('classes.nodataOption')}</option>
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {unassigned.length > 0 && (
            <Note tone="warning">
              {t('classes.unassignedWarning', { count: unassigned.length })}
            </Note>
          )}
        </div>
      </section>
    </div>
  );
};
