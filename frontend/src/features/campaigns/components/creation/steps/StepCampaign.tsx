import type { CampaignCreate, ProjectUserOut } from '~/api/client';
import { Input } from '~/shared/ui/forms';
import { useAccountStore } from '~/shared/stores/account.store';
import { LabellingPolicyEditor } from '~/features/campaigns/components/LabellingPolicyEditor';
import { DEFAULT_LABELLING_POLICY } from '~/features/campaigns/utils/labellingPolicy';

const MEMBERS_HINT = 'Members come from the project - manage them under the project’s Members tab.';

export const StepCampaign = ({
  form,
  setForm,
  projectIsPublic,
  members,
}: {
  form: CampaignCreate;
  setForm: (f: CampaignCreate) => void;
  /** The owning project's visibility - campaigns have none of their own, and
   *  it gates the 'anyone' audience in the labelling policy. */
  projectIsPublic: boolean;
  members: ProjectUserOut[];
}) => {
  const account = useAccountStore((s) => s.account);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <p className="text-sm text-neutral-700">Give your campaign a clear, human-readable name.</p>

        <Input
          placeholder="Your campaign name…"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-neutral-900">Labelling access</p>
        <p className="text-sm text-neutral-600">
          Every campaign supports both task-by-task labeling and free exploration - annotators can
          switch between them anytime from the annotation view. Control who may label what, and
          whose labels count toward completing a task. You can revisit this later in campaign
          settings.
        </p>

        <LabellingPolicyEditor
          value={form.labelling_policy ?? DEFAULT_LABELLING_POLICY}
          onChange={(labelling_policy) => setForm({ ...form, labelling_policy })}
          isPublic={projectIsPublic}
          members={members}
          defaultSelectedMemberIds={account ? [account.id] : undefined}
          membersHint={MEMBERS_HINT}
        />
      </div>
    </div>
  );
};
