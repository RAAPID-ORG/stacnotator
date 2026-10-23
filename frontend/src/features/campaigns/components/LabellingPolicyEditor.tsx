import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { LabellingPolicy, PolicyAudience, ProjectUserOut } from '~/api/client';
import { Tooltip } from '~/shared/ui/Tooltip';

type AxisKey = keyof LabellingPolicy;
type PolicyKind = 'admins' | 'authoritative' | 'assignees' | 'members' | 'anyone';

// Per-axis allowed kinds, mirrors backend/src/campaigns/schemas.py validators.
const AXES: { key: AxisKey; allowedKinds: PolicyKind[] }[] = [
  { key: 'explore', allowedKinds: ['admins', 'authoritative', 'members', 'anyone'] },
  { key: 'unassigned_tasks', allowedKinds: ['admins', 'authoritative', 'members', 'anyone'] },
  {
    key: 'assigned_tasks',
    allowedKinds: ['admins', 'authoritative', 'assignees', 'members', 'anyone'],
  },
  { key: 'complete_assigned', allowedKinds: ['admins', 'authoritative', 'assignees', 'members'] },
  { key: 'modify_others', allowedKinds: ['admins', 'authoritative', 'members'] },
];

const emptyAudience: PolicyAudience = { kinds: [], user_ids: [] };

const memberName = (u: ProjectUserOut) => u.user.display_name;

interface LabellingPolicyEditorProps {
  value: LabellingPolicy;
  onChange: (value: LabellingPolicy) => void;
  isPublic: boolean;
  /** Omit where project members aren't known yet - the "selected members"
   * option is hidden in that case. */
  members?: ProjectUserOut[];
  /** User IDs to seed into an axis's user_ids the first time its "Selected
   * members" checkbox is enabled with nothing selected yet (e.g. the
   * campaign creator, pre-checked in the create wizard). Filtered to known
   * `members`. Absent means seed empty, matching prior behavior. */
  defaultSelectedMemberIds?: string[];
  /** Muted helper text rendered under an axis's expanded member picker, e.g.
   * pointing users at where to add more members later. */
  membersHint?: string;
}

export const LabellingPolicyEditor = ({
  value,
  onChange,
  isPublic,
  members,
  defaultSelectedMemberIds,
  membersHint,
}: LabellingPolicyEditorProps) => {
  const { t } = useTranslation('campaigns');
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

  // A private project must not leave 'anyone' checked on any axis - the
  // backend rejects it with a 400, and an already-checked box surviving the
  // flip is an inconsistent, confusing UI state.
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
    const current = value[key] ?? emptyAudience;
    const kinds = new Set(current.kinds ?? []);
    if (checked) kinds.add(kind);
    else kinds.delete(kind);
    updateAxis(key, { kinds: Array.from(kinds) });
  };

  const toggleMembersEnabled = (key: AxisKey, checked: boolean) => {
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
    const current = value[key] ?? emptyAudience;
    const ids = new Set(current.user_ids ?? []);
    if (checked) ids.add(userId);
    else ids.delete(userId);
    updateAxis(key, { user_ids: Array.from(ids) });
  };

  return (
    <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
      {AXES.map((axis) => {
        const audience = value[axis.key] ?? emptyAudience;
        const kinds = new Set(audience.kinds ?? []);
        const selectedMemberIds = new Set(audience.user_ids ?? []);
        const membersEnabled = expanded[axis.key];
        const isNoOne = kinds.size === 0 && selectedMemberIds.size === 0;

        return (
          <li key={axis.key} className="py-4 space-y-3">
            <div>
              <h3 className="text-sm font-medium text-neutral-900">
                {t(`policy.axes.${axis.key}.title`)}
              </h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                {t(`policy.axes.${axis.key}.description`)}
              </p>
              <p className="text-xs text-neutral-400 mt-1">
                <Trans
                  t={t}
                  i18nKey="policy.example"
                  values={{ example: t(`policy.axes.${axis.key}.example`) }}
                  components={{ label: <span className="font-medium" /> }}
                />
              </p>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {axis.allowedKinds.map((kind) => {
                const anyoneDisabled = kind === 'anyone' && !isPublic;
                return (
                  <Tooltip key={kind} text={t(`policy.kinds.${kind}.help`)} align="start">
                    <label
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
                      {t(`policy.kinds.${kind}.label`)}
                    </label>
                  </Tooltip>
                );
              })}

              {members !== undefined && (
                <label className="flex items-center gap-1.5 text-xs text-neutral-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={membersEnabled}
                    onChange={(e) => toggleMembersEnabled(axis.key, e.target.checked)}
                  />
                  {t('policy.selectedMembers')}
                </label>
              )}
            </div>

            {members !== undefined && membersEnabled && (
              <div className="rounded-md border border-neutral-200 p-2.5 max-h-40 overflow-y-auto space-y-1">
                {members.length === 0 ? (
                  <p className="text-xs text-neutral-400">{t('policy.noMembers')}</p>
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

            {isNoOne && <p className="text-xs text-neutral-400 italic">{t('policy.noOne')}</p>}
          </li>
        );
      })}
    </ul>
  );
};

export default LabellingPolicyEditor;
