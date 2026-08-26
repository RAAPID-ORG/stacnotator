import type { CampaignCreate, ProjectUserOut } from '~/api/client';
import { useAccountStore } from '~/shared/stores/account.store';
import { LabellingPolicyEditor } from '~/features/campaigns/components/LabellingPolicyEditor';
import { DEFAULT_LABELLING_POLICY } from '~/features/campaigns/utils/labellingPolicy';

const MEMBERS_HINT = 'Members come from the project - manage them under the project’s Members tab.';

export const StepAccess = ({
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
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-neutral-700">
          Every campaign supports both task-by-task labelling and free exploration - annotators can
          switch between them anytime from the annotation view. The rules below decide who may label
          what, and whose labels count toward completing a task. You can change all of this later in
          campaign settings.
        </p>
        <p className="text-xs text-neutral-500">
          Each rule is a list of groups. Hover a group to see who it means. Leaving a rule empty
          turns that activity off for everyone.
        </p>
      </div>

      <LabellingPolicyEditor
        value={form.labelling_policy ?? DEFAULT_LABELLING_POLICY}
        onChange={(labelling_policy) => setForm({ ...form, labelling_policy })}
        isPublic={projectIsPublic}
        members={members}
        defaultSelectedMemberIds={account ? [account.id] : undefined}
        membersHint={MEMBERS_HINT}
      />
    </div>
  );
};
