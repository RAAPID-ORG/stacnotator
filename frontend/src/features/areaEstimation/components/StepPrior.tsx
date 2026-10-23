import { Trans, useTranslation } from 'react-i18next';
import { Badge, type BadgeTone } from '~/shared/ui/Badge';
import { Input } from '~/shared/ui/forms';
import { PRIOR_SOURCES, priorSource, type PriorFit, type PriorSourceId } from '../core/guidance';
import type { AreaEstimationPlan } from '../core/plan';
import { defaultCorrectShare, pixelsFor, planNeedsPilot } from '../core/plan';
import { ChoiceCard, RICH_TEXT, StepHeading, SubHeading } from './Explain';
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
  const { t } = useTranslation('areaEstimation');
  const sourceTitle = t(`prior.sources.${priorSource(plan.priorSourceId).id}.title`);
  // Mid-sentence, so the title keeps its own article but loses its capital.
  const sourceName = sourceTitle.charAt(0).toLowerCase() + sourceTitle.slice(1);
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
        title={t('prior.title')}
        technical={
          <>
            <p>
              <Trans t={t} i18nKey="prior.technical1" components={RICH_TEXT} />
            </p>
            <p className="mt-1.5">{t('prior.technical2')}</p>
          </>
        }
        source={t('prior.source')}
      >
        <Trans t={t} i18nKey="prior.intro" components={RICH_TEXT} />
      </StepHeading>

      <section className="space-y-3">
        <SubHeading
          title={t('prior.knowingTitle')}
          technical={
            <p>
              <Trans t={t} i18nKey="prior.knowingTechnical" components={RICH_TEXT} />
            </p>
          }
          source={t('prior.knowingSource')}
        >
          {t('prior.knowingIntro')}
        </SubHeading>

        <dl className="space-y-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-[13px] leading-relaxed text-neutral-700">
          <Term term={t('prior.uaTerm')}>{t('prior.uaDefinition')}</Term>
          <Term term={t('prior.paTerm')}>{t('prior.paDefinition')}</Term>
          <Term term={t('prior.oaTerm')}>{t('prior.oaDefinition')}</Term>
        </dl>

        <p className="text-xs leading-snug text-neutral-500">{t('prior.notCounting')}</p>
      </section>

      <section className="space-y-2">
        <SubHeading title={t('prior.basisTitle')}>{t('prior.basisIntro')}</SubHeading>
        <div className="grid grid-cols-1 gap-2">
          {PRIOR_SOURCES.map((s) => (
            <ChoiceCard
              key={s.id}
              selected={plan.priorSourceId === s.id}
              onSelect={() => chooseSource(s.id)}
              title={t(`prior.sources.${s.id}.title`)}
              badge={<Badge tone={FIT_TONE[s.fit]}>{t(`prior.sources.${s.id}.fitLabel`)}</Badge>}
              testId={`uae-prior-${s.id}`}
            >
              {t(`prior.sources.${s.id}.summary`)}
              {plan.priorSourceId === s.id && (
                <span className="mt-2 block leading-relaxed text-neutral-700">
                  {t(`prior.sources.${s.id}.rationale`)}
                </span>
              )}
            </ChoiceCard>
          ))}
        </div>
      </section>

      {!planNeedsPilot(plan) && (
        <section className="space-y-4">
          <SubHeading
            title={t('prior.uaTitle')}
            technical={<p>{t('prior.uaTechnical')}</p>}
            source={t('prior.uaSource')}
          >
            {t('prior.uaIntro')}
          </SubHeading>

          <p className="text-xs leading-snug text-neutral-500">
            {t('prior.startingValues', { source: sourceName })}
          </p>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="py-2 font-medium">{t('table.stratum')}</th>
                <th className="py-2 pr-8 font-medium w-28 text-right">
                  {t('table.stratumWeight')}
                </th>
                <th className="py-2 font-medium w-[22rem]">{t('prior.uaColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {plan.classes.map((cls) => {
                const name = cls.name || t('unnamedClass');
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
                          aria-label={t('prior.uaSliderAria', { name })}
                        />
                        <span className="w-16 shrink-0">
                          <Input
                            type="number"
                            size="sm"
                            min={1}
                            max={100}
                            step={1}
                            className="text-right tabular-nums"
                            aria-label={t('prior.uaInputAria', { name })}
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
        <SubHeading title={t('prior.pilotTitle')} technical={<p>{t('prior.pilotTechnical')}</p>}>
          <Trans t={t} i18nKey="prior.pilotIntro" components={RICH_TEXT} />
        </SubHeading>
      )}
    </div>
  );
};
