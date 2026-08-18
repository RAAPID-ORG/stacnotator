import { useState } from 'react';
import { setDataSharing } from '~/api/client';
import { DATA_SHARING_OPTIONS, type DataSharingChoice } from '~/features/legal/dataSharing';
import { legalPath } from '~/features/legal/docs';
import { Modal } from '~/shared/ui/Modal';
import { handleError } from '~/shared/utils/errorHandler';
import { isAudienceMember } from '../campaign/annotation';
import { useCampaignStore, usePolicy } from '../stores/campaign';

/** Asks, once per campaign, whether this annotator's work here may be published as
 *  research data. Answering is optional in substance - "Keep private" is one click
 *  and changes nothing - but the question is asked before any annotation is shared,
 *  which is what makes the consent worth anything. */
export function DataSharingPrompt({ paused }: { paused: boolean }) {
  const campaign = useCampaignStore((s) => s.campaign);
  const setChoice = useCampaignStore((s) => s.setDataSharing);
  const policy = usePolicy();
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState<DataSharingChoice | null>(null);

  if (paused || dismissed || !campaign) return null;
  if (campaign.viewer_data_sharing != null) return null;

  // Only people who can actually label here have anything to share. Asked against
  // the labelling policy rather than membership, so an "anyone" campaign's
  // non-member annotators are asked too.
  const audiences = campaign.settings.labelling_policy;
  const mayLabel =
    isAudienceMember(audiences.explore, policy) ||
    isAudienceMember(audiences.unassigned_tasks, policy) ||
    isAudienceMember(audiences.assigned_tasks, policy);
  if (!mayLabel) return null;

  const choose = async (choice: DataSharingChoice) => {
    setSaving(choice);
    try {
      await setDataSharing({ path: { campaign_id: campaign.id }, body: { choice } });
      setChoice(choice);
    } catch (error) {
      handleError(error, 'Could not save your choice');
      setSaving(null);
    }
  };

  return (
    <Modal
      title="Share your annotations for research?"
      onClose={() => setDismissed(true)}
      maxWidth="max-w-md"
    >
      <div className="px-5 py-4 space-y-4" data-testid="data-sharing-prompt">
        <p className="text-sm text-neutral-600">
          The annotations you create in <span className="font-medium">{campaign.name}</span> can be
          published as open research data. Your choice applies to this campaign only, does not
          affect your work here, and can be changed any time in Settings.
        </p>

        <div className="space-y-2">
          {DATA_SHARING_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={saving !== null}
              onClick={() => choose(option.value)}
              data-testid={`data-sharing-${option.value}`}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-left transition-colors hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50"
            >
              <div className="text-sm font-medium text-neutral-900">{option.label}</div>
              <div className="text-xs text-neutral-500">{option.description}</div>
            </button>
          ))}
        </div>

        <p className="text-xs text-neutral-500">
          See{' '}
          <a
            href={legalPath('terms')}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-brand-700"
          >
            Sharing Your Annotations for Research
          </a>{' '}
          in the Terms of Service.
        </p>
      </div>
    </Modal>
  );
}
