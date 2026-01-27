import type { CampaignCreate } from '~/api/client';
export const StepReview = ({ form }: { form: CampaignCreate }) => {
  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-700">Review everything before creating the campaign.</p>

      <pre className="bg-neutral-100 rounded-md p-4 text-xs text-neutral-700 overflow-auto">
        {JSON.stringify(form, null, 2)}
      </pre>
    </div>
  );
};
