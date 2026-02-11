import type { CampaignCreate } from '~/api/client';
import type { FullValidationResult } from '~/features/campaigns/utils/campaignValidation';
import { ValidationSummary, ValidationSuccess } from '~/features/campaigns/components/ValidationUI';
import { STEP_CONFIG } from '../CreateCampaignModal';

export const StepReview = ({
  form,
  validation,
}: {
  form: CampaignCreate;
  validation: FullValidationResult;
}) => {
  // Collect all error messages across steps for the summary
  const allErrors: string[] = [];
  const stepNames = STEP_CONFIG[form.mode as 'tasks' | 'open'].map((s) => s.name);

  const stepResults = [
    validation.campaign,
    validation.settings,
    validation.imagery,
    validation.timeseries,
  ];

  stepResults.forEach((result, i) => {
    Object.values(result.errors).forEach((msg) => {
      allErrors.push(`${stepNames[i]}: ${msg}`);
    });
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-700">Review everything before creating the campaign.</p>

      {!validation.isValid && <ValidationSummary errors={allErrors} />}

      {validation.isValid && <ValidationSuccess />}

      <pre className="bg-neutral-100 rounded-md p-4 text-xs text-neutral-700 overflow-auto">
        {JSON.stringify(form, null, 2)}
      </pre>
    </div>
  );
};
