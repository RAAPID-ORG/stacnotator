import type { FullValidationResult } from '~/features/campaigns/utils/campaignValidation';
import { ValidationSummary, ValidationSuccess } from '~/features/campaigns/components/ValidationUI';

export const StepReview = ({ validation }: { validation: FullValidationResult }) => {
  // Named rather than zipped against the step list: the wizard's order has
  // changed before, and a positional mapping labels errors with the wrong step.
  const byStep: [string, typeof validation.campaign][] = [
    ['Campaign', validation.campaign],
    ['Settings', validation.settings],
    ['Imagery', validation.imagery],
    ['Time Series', validation.timeseries],
  ];

  const allErrors = byStep.flatMap(([name, result]) =>
    Object.values(result.errors).map((msg) => `${name}: ${msg}`)
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-700">Review everything before creating the campaign.</p>

      {validation.isValid ? <ValidationSuccess /> : <ValidationSummary errors={allErrors} />}
    </div>
  );
};
