import { useEffect, useState } from 'react';
import type { CampaignUserOut, LabellingPolicy, PolicyAudience } from '~/api/client';
import { Tooltip } from '~/shared/ui/Tooltip';

type AxisKey = keyof LabellingPolicy;
type PolicyKind = 'admins' | 'authoritative' | 'assignees' | 'members' | 'anyone';

const KIND_LABELS: Record<PolicyKind, string> = {
  admins: 'Admins',
  authoritative: 'Authoritative reviewers',
  assignees: 'Assignees',
  members: 'Members',
  anyone: 'Anyone (public visitors)',
};

// Per-axis allowed kinds, mirrors backend/src/campaigns/schemas.py validators.
const AXES: {
  key: AxisKey;
  title: string;
  description: string;
  allowedKinds: PolicyKind[];
}[] = [
  {
    key: 'explore',
    title: 'Explorative labelling',
    description: 'Who may create free-form, standalone annotations that are not tied to a task.',
    allowedKinds: ['admins', 'members', 'anyone'],
  },
  {
    key: 'unassigned_tasks',
    title: 'Unassigned tasks',
    description: 'Whose labels on tasks with no assignment count toward completing that task.',
    allowedKinds: ['admins', 'authoritative', 'members', 'anyone'],
  },
  {
    key: 'assigned_tasks',
    title: 'Assigned tasks - additional labels',
    description:
      'Who may add extra labels to a task that is already assigned to someone else. Extra ' +
      'labels are shown alongside the assignee’s but do not necessarily count toward completion.',
    allowedKinds: ['admins', 'authoritative', 'assignees', 'members', 'anyone'],
  },
  {
    key: 'complete_assigned',
    title: 'Assigned tasks - completion',
    description:
      'Whose labels on an assigned task count toward completing it, including satisfying ' +
      'review requirements.',
    allowedKinds: ['admins', 'authoritative', 'assignees', 'members'],
  },
];

const emptyAudience: PolicyAudience = { kinds: [], user_ids: [] };

// Matches backend/src/campaigns/schemas.py default_labelling_policy(): any
// member can label anything; completion stays with assignees/admins/
// authoritative. Used to seed a new campaign in the wizard.
export const DEFAULT_LABELLING_POLICY: LabellingPolicy = {
  explore: { kinds: ['members'], user_ids: [] },
  unassigned_tasks: { kinds: ['members'], user_ids: [] },
  assigned_tasks: { kinds: ['members'], user_ids: [] },
  complete_assigned: { kinds: ['assignees', 'admins', 'authoritative'], user_ids: [] },
};

const memberName = (u: CampaignUserOut) => u.user.display_name || u.user.email;

interface LabellingPolicyEditorProps {
  value: LabellingPolicy;
  onChange: (value: LabellingPolicy) => void;
  isPublic: boolean;
  /** Omit where campaign members aren't known yet - the "selected members"
   * option is hidden in that case. */
  members?: CampaignUserOut[];
  /** User IDs to seed into an axis's user_ids the first time its "Selected
   * members" checkbox is enabled with nothing selected yet (e.g. the
   * campaign creator, pre-checked in the create wizard). Filtered to known
   * `members`. Absent means seed empty, matching prior behavior. */
  defaultSelectedMemberIds?: string[];
  /** Muted helper text rendered under an axis's expanded member picker, e.g.
   * pointing users at where to add more members later. */
  membersHint?: string;
  /** Called only for direct user interaction with a checkbox (kind, member
   * toggle) - not for the isPublic-driven 'anyone' strip below. Lets callers
   * (e.g. the create wizard) distinguish "user customized the policy" from
   * changes this component makes on its own. */
  onTouch?: () => void;
}

export const LabellingPolicyEditor = ({
  value,
  onChange,
  isPublic,
  members,
  defaultSelectedMemberIds,
  membersHint,
  onTouch,
}: LabellingPolicyEditorProps) => {
  // UI-only: whether the member picker is expanded for a given axis. Seeded
  // from any pre-selected members so editing an existing policy shows them
  // immediately; unlike `value` this doesn't collapse back when the picker
  // is toggled on with nothing selected yet.
  const [expanded, setExpanded] = useState<Record<AxisKey, boolean>>(
    () =>
      Object.fromEntries(
        AXES.map((axis) => [axis.key, (value[axis.key]?.user_ids?.length ?? 0) > 0])
      ) as Record<AxisKey, boolean>
  );

  // A campaign going private must not leave 'anyone' checked on any axis -
  // the backend rejects it with a 400, and an already-checked box surviving
  // the flip is an inconsistent, confusing UI state. Strips unconditionally
  // (independent of any "touched" tracking a caller does) whenever isPublic
  // is or becomes false.
  useEffect(() => {
    if (isPublic) return;
    const hasAnyone = AXES.some((axis) => (value[axis.key]?.kinds ?? []).includes('anyone'));
    if (!hasAnyone) return;
    const stripped = Object.fromEntries(
      AXES.map((axis) => {
        const current = value[axis.key] ?? emptyAudience;
        return [
          axis.key,
          { ...current, kinds: (current.kinds ?? []).filter((k) => k !== 'anyone') },
        ];
      })
    ) as LabellingPolicy;
    onChange(stripped);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to isPublic flipping, reading the latest value/onChange from closure
  }, [isPublic]);

  const updateAxis = (key: AxisKey, updates: Partial<PolicyAudience>) => {
    const current = value[key] ?? emptyAudience;
    onChange({ ...value, [key]: { ...current, ...updates } });
  };

  const toggleKind = (key: AxisKey, kind: PolicyKind, checked: boolean) => {
    onTouch?.();
    const current = value[key] ?? emptyAudience;
    const kinds = new Set(current.kinds ?? []);
    if (checked) kinds.add(kind);
    else kinds.delete(kind);
    updateAxis(key, { kinds: Array.from(kinds) });
  };

  const toggleMembersEnabled = (key: AxisKey, checked: boolean) => {
    onTouch?.();
    setExpanded((prev) => ({ ...prev, [key]: checked }));
    if (!checked) {
      updateAxis(key, { user_ids: [] });
      return;
    }
    const current = value[key] ?? emptyAudience;
    if ((current.user_ids ?? []).length > 0 || !defaultSelectedMemberIds?.length) return;
    const knownIds = new Set((members ?? []).map((m) => m.user.id));
    const seeded = defaultSelectedMemberIds.filter((id) => knownIds.has(id));
    if (seeded.length > 0) updateAxis(key, { user_ids: seeded });
  };

  const toggleMember = (key: AxisKey, userId: string, checked: boolean) => {
    onTouch?.();
    const current = value[key] ?? emptyAudience;
    const ids = new Set(current.user_ids ?? []);
    if (checked) ids.add(userId);
    else ids.delete(userId);
    updateAxis(key, { user_ids: Array.from(ids) });
  };

  return (
    <div className="space-y-3">
      {AXES.map((axis) => {
        const audience = value[axis.key] ?? emptyAudience;
        const kinds = new Set(audience.kinds ?? []);
        const selectedMemberIds = new Set(audience.user_ids ?? []);
        const membersEnabled = expanded[axis.key];
        const isNoOne = kinds.size === 0 && selectedMemberIds.size === 0;

        return (
          <div
            key={axis.key}
            className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-4 space-y-3"
          >
            <div>
              <h3 className="text-sm font-medium text-neutral-900">{axis.title}</h3>
              <p className="text-xs text-neutral-500 mt-0.5">{axis.description}</p>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {axis.allowedKinds.map((kind) => {
                const anyoneDisabled = kind === 'anyone' && !isPublic;
                const checkbox = (
                  <label
                    key={kind}
                    className={`flex items-center gap-1.5 text-xs text-neutral-700 ${
                      anyoneDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={kinds.has(kind)}
                      disabled={anyoneDisabled}
                      onChange={(e) => toggleKind(axis.key, kind, e.target.checked)}
                    />
                    {KIND_LABELS[kind]}
                  </label>
                );
                return anyoneDisabled ? (
                  <Tooltip key={kind} text="Only available for public campaigns.">
                    {checkbox}
                  </Tooltip>
                ) : (
                  checkbox
                );
              })}

              {members !== undefined && (
                <label className="flex items-center gap-1.5 text-xs text-neutral-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={membersEnabled}
                    onChange={(e) => toggleMembersEnabled(axis.key, e.target.checked)}
                  />
                  Selected members
                </label>
              )}
            </div>

            {members !== undefined && membersEnabled && (
              <div className="rounded-md border border-neutral-200 bg-white p-2.5 max-h-40 overflow-y-auto space-y-1">
                {members.length === 0 ? (
                  <p className="text-xs text-neutral-400">No members in this campaign yet.</p>
                ) : (
                  members.map((m) => (
                    <label
                      key={m.user.id}
                      className="flex items-center gap-1.5 text-xs text-neutral-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedMemberIds.has(m.user.id)}
                        onChange={(e) => toggleMember(axis.key, m.user.id, e.target.checked)}
                      />
                      {memberName(m)}
                    </label>
                  ))
                )}
                {membersHint && <p className="text-xs text-neutral-400 italic">{membersHint}</p>}
              </div>
            )}

            {isNoOne && (
              <p className="text-xs text-neutral-400 italic">No one - this axis is disabled.</p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default LabellingPolicyEditor;
