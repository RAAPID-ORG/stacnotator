import { useState } from 'react';
import { duplicateCampaign, type CampaignListItemOut, type CampaignOut } from '~/api/client';
import { Modal } from '~/shared/ui/Modal';
import { Button } from '~/shared/ui/forms';
import { IconInfo } from '~/shared/ui/Icons';
import { handleError } from '~/shared/utils/errorHandler';

/** Tri-state on purpose: both switches must be an explicit decision before
 *  the duplicate can run - they are the two things people forget to think
 *  about when cloning a campaign. */
type Choice = boolean | null;

const YesNoChoice = ({
  value,
  onChange,
  testId,
}: {
  value: Choice;
  onChange: (v: boolean) => void;
  testId: string;
}) => (
  <div className="flex shrink-0 gap-1" role="radiogroup" data-testid={testId}>
    {([true, false] as const).map((option) => (
      <button
        key={String(option)}
        type="button"
        role="radio"
        aria-checked={value === option}
        onClick={() => onChange(option)}
        className={`w-14 rounded-md border px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
          value === option
            ? 'border-brand-600 bg-brand-50 text-brand-800'
            : 'border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-700'
        }`}
      >
        {option ? 'Yes' : 'No'}
      </button>
    ))}
  </div>
);

interface DuplicateCampaignModalProps {
  campaign: CampaignListItemOut;
  onClose: () => void;
  /** Called with the freshly created campaign after a successful duplicate. */
  onDuplicated: (created: CampaignOut) => void;
}

export const DuplicateCampaignModal = ({
  campaign,
  onClose,
  onDuplicated,
}: DuplicateCampaignModalProps) => {
  const [includeTasks, setIncludeTasks] = useState<Choice>(null);
  const [includeAnnotations, setIncludeAnnotations] = useState<Choice>(null);
  const [includeUserLayouts, setIncludeUserLayouts] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const ready = includeTasks !== null && includeAnnotations !== null;

  const handleDuplicate = async () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await duplicateCampaign({
        path: { campaign_id: campaign.id },
        body: {
          include_tasks: includeTasks,
          include_annotations: includeAnnotations,
          include_user_layouts: includeUserLayouts,
        },
      });
      if (error || !data) {
        handleError(error, 'Failed to duplicate campaign');
        return;
      }
      onDuplicated(data);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={`Duplicate "${campaign.name}"`}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleDuplicate}
            disabled={!ready || submitting}
            title={ready ? undefined : 'Answer both questions first'}
            data-testid="confirm-duplicate-campaign"
          >
            {submitting ? 'Duplicating…' : 'Duplicate campaign'}
          </Button>
        </div>
      }
    >
      <div className="px-5 py-4 space-y-4">
        <p className="text-xs leading-relaxed text-neutral-600">
          Creates a new campaign in this project with the same setup: imagery sources and
          visualizations, views and layouts, labels and forms, labelling policy, time series,
          basemaps and overlays. Adjust the copy afterwards in its settings.
        </p>

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 p-3">
            <div>
              <p className="text-xs font-semibold text-neutral-800">Also duplicate tasks?</p>
              <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">
                Copies all task locations, task sets and explicit user assignments. Task progress
                starts fresh unless annotations are copied too.
              </p>
            </div>
            <YesNoChoice value={includeTasks} onChange={setIncludeTasks} testId="duplicate-tasks" />
          </div>

          <div className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 p-3">
            <div>
              <p className="text-xs font-semibold text-neutral-800">Also duplicate annotations?</p>
              <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">
                Copies every existing label with its author and timestamps into the new campaign.
              </p>
            </div>
            <YesNoChoice
              value={includeAnnotations}
              onChange={setIncludeAnnotations}
              testId="duplicate-annotations"
            />
          </div>

          <div className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 p-3">
            <div>
              <p className="text-xs font-semibold text-neutral-800">Keep personal layouts?</p>
              <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">
                Copies the canvas window arrangements individual users saved for themselves.
              </p>
            </div>
            <YesNoChoice
              value={includeUserLayouts}
              onChange={setIncludeUserLayouts}
              testId="duplicate-user-layouts"
            />
          </div>
        </div>

        {includeAnnotations === true && includeTasks === false && (
          <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
            <IconInfo className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
            <p className="text-[11px] leading-snug text-amber-800">
              Without tasks, only annotations that are not linked to a task (open-mode labels) are
              copied.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};
