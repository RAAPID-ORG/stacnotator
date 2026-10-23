import { useTranslation } from 'react-i18next';
import type { FullValidationResult } from '~/features/campaigns/utils/campaignValidation';
import { ValidationSummary, ValidationSuccess } from '~/features/campaigns/components/ValidationUI';

export const StepReview = ({ validation }: { validation: FullValidationResult }) => {
  const { t } = useTranslation('campaigns');
  // Named rather than zipped against the step list: the wizard's order has
  // changed before, and a positional mapping labels errors with the wrong step.
  const byStep: [string, typeof validation.campaign][] = [
    [t('wizard.steps.campaign'), validation.campaign],
    [t('wizard.steps.settings'), validation.settings],
    [t('wizard.steps.imagery'), validation.imagery],
    [t('wizard.steps.timeseries'), validation.timeseries],
  ];

  const allErrors = byStep.flatMap(([step, result]) =>
    Object.values(result.errors).map((message) => t('wizard.review.stepError', { step, message }))
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-700">{t('wizard.review.intro')}</p>

      {validation.isValid ? <ValidationSuccess /> : <ValidationSummary errors={allErrors} />}
    </div>
  );
};
