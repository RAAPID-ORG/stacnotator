import { useMemo, useState } from 'react';
import type { CampaignCreate, CampaignUserOut, LabellingPolicy } from '~/api/client';
import { Input } from '~/shared/ui/forms';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useAccountStore } from '~/shared/stores/account.store';
import {
  DEFAULT_LABELLING_POLICY,
  LabellingPolicyEditor,
} from '~/features/campaigns/components/LabellingPolicyEditor';

const MEMBERS_HINT =
  'Only you are a member right now. Add more users under Settings > Users after the campaign is created.';

// Axes that get 'anyone' seeded onto them when a campaign becomes public and
// the user hasn't customized the labelling policy yet. complete_assigned
// deliberately excluded - 'anyone' isn't a valid kind there (backend and the
// editor both reject it).
const PUBLIC_SEEDED_AXES: (keyof LabellingPolicy)[] = [
  'explore',
  'unassigned_tasks',
  'assigned_tasks',
];

const withAnyoneSeeded = (policy: LabellingPolicy): LabellingPolicy => {
  const seeded = { ...policy };
  for (const axis of PUBLIC_SEEDED_AXES) {
    const current = policy[axis] ?? { kinds: [], user_ids: [] };
    const kinds = new Set(current.kinds ?? []);
    kinds.add('anyone');
    seeded[axis] = { ...current, kinds: Array.from(kinds) };
  }
  return seeded;
};

export const StepCampaign = ({
  form,
  setForm,
}: {
  form: CampaignCreate;
  setForm: (f: CampaignCreate) => void;
}) => {
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);
  const account = useAccountStore((s) => s.account);
  // Whether the user has directly edited the labelling policy in this wizard
  // session. Once true, toggling "Public" stops auto-seeding 'anyone' onto
  // the axes - their choices win instead.
  const [policyTouched, setPolicyTouched] = useState(false);

  // The campaign creator is auto-added as an admin + authoritative reviewer
  // on creation (backend/src/campaigns/service.py create_campaign), so this
  // mirrors that membership to let the wizard pre-select them as a "Selected
  // members" entry before the campaign - and its real membership row - exist.
  const creatorEntry: CampaignUserOut[] = useMemo(() => {
    if (!account) return [];
    return [
      {
        user: { id: account.id, email: account.email, display_name: account.display_name },
        is_admin: true,
        is_authorative_reviewer: true,
      },
    ];
  }, [account]);

  const handleVisibilityChange = async (checked: boolean) => {
    if (!checked) {
      setForm({ ...form, is_public: false });
      return;
    }
    const confirmed = await showConfirmDialog({
      title: 'Make Campaign Public?',
      description:
        'Any signed-in user will be able to view this campaign and add annotations to it. They can only edit or delete their own annotations, but their contributions will be visible to everyone. Task assignment remains restricted to campaign members.',
      confirmText: 'Make Public',
      cancelText: 'Cancel',
      isDangerous: true,
    });
    if (!confirmed) return;
    if (policyTouched) {
      setForm({ ...form, is_public: true });
      return;
    }
    setForm({
      ...form,
      is_public: true,
      labelling_policy: withAnyoneSeeded(form.labelling_policy ?? DEFAULT_LABELLING_POLICY),
    });
  };

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
        <p className="text-sm font-medium text-neutral-900">Visibility</p>
        <label className="flex items-start space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_public ?? false}
            onChange={(e) => handleVisibilityChange(e.target.checked)}
            className="mt-1 text-brand-700 focus:ring-brand-600"
          />
          <div className="flex-1">
            <div className="font-medium text-sm text-neutral-900">Public campaign</div>
            <div className="text-sm text-neutral-600">
              Anyone can view and add annotations to this campaign. Users can only edit or delete
              their own annotations. Task assignment is still restricted to campaign members.
            </div>
          </div>
        </label>
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
          onTouch={() => setPolicyTouched(true)}
          isPublic={form.is_public ?? false}
          members={account ? creatorEntry : undefined}
          defaultSelectedMemberIds={account ? [account.id] : undefined}
          membersHint={account ? MEMBERS_HINT : undefined}
        />
      </div>
    </div>
  );
};
