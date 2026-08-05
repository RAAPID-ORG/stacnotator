import { useCallback, useEffect, useState } from 'react';
import {
  addOrganizationUsers,
  demoteOrganizationAdmin,
  getOrganizationUsers,
  makeOrganizationAdmin,
  removeOrganizationMember,
  type AddUsersByEmailResult,
  type OrganizationUserOut,
} from '~/api/client';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Badge } from '~/shared/ui/Badge';
import { Button, Field, Textarea } from '~/shared/ui/forms';
import { handleError } from '~/shared/utils/errorHandler';
import { parseEmailList } from '../utils/organizations';

export type OrganizationMembersProps = {
  organizationId: number;
};

const rowActionClass =
  'inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

const memberName = (member: OrganizationUserOut) => member.user.display_name || member.user.email;

export const OrganizationMembers = ({ organizationId }: OrganizationMembersProps) => {
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);

  const [members, setMembers] = useState<OrganizationUserOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [emailsText, setEmailsText] = useState('');
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<AddUsersByEmailResult | null>(null);
  const [malformed, setMalformed] = useState<string[]>([]);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getOrganizationUsers({ path: { organization_id: organizationId } });
      setMembers(data?.users ?? []);
      setError(null);
    } catch (err) {
      setError(handleError(err, 'Failed to load organization members', { showUser: false }));
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const runMemberAction = async (action: () => Promise<unknown>, failureContext: string) => {
    setBusy(true);
    try {
      await action();
      await loadMembers();
      setError(null);
    } catch (err) {
      setError(handleError(err, failureContext, { showUser: false }));
    } finally {
      setBusy(false);
    }
  };

  const toggleAdmin = (member: OrganizationUserOut) =>
    runMemberAction(
      () =>
        member.is_admin
          ? demoteOrganizationAdmin({
              path: { organization_id: organizationId, user_id: member.user.id },
            })
          : makeOrganizationAdmin({
              path: { organization_id: organizationId, user_id: member.user.id },
            }),
      'Failed to update member role'
    );

  const removeMember = async (member: OrganizationUserOut) => {
    const confirmed = await showConfirmDialog({
      title: `Remove ${memberName(member)}?`,
      description: 'They lose access to this organization and its projects.',
      confirmText: 'Remove',
      isDangerous: true,
    });
    if (!confirmed) return;
    await runMemberAction(
      () =>
        removeOrganizationMember({
          path: { organization_id: organizationId, user_id: member.user.id },
        }),
      'Failed to remove member'
    );
  };

  const addMembers = async () => {
    const { emails, invalid } = parseEmailList(emailsText);
    setMalformed(invalid);
    if (emails.length === 0) {
      setAddResult(null);
      return;
    }

    setAdding(true);
    try {
      const { data } = await addOrganizationUsers({
        path: { organization_id: organizationId },
        body: { emails },
      });
      setAddResult(data ?? null);
      setEmailsText('');
      await loadMembers();
      setError(null);
    } catch (err) {
      setError(handleError(err, 'Failed to add members', { showUser: false }));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="surface">
      <section className="surface-section">
        <h2 className="section-heading">Add members</h2>
        <p className="section-description">
          Paste one or more email addresses, separated by commas, spaces, or newlines.
        </p>
        <div className="space-y-3 max-w-xl">
          <Field label="Emails" htmlFor="org-member-emails">
            <Textarea
              id="org-member-emails"
              data-testid="org-member-emails"
              value={emailsText}
              onChange={(e) => setEmailsText(e.target.value)}
              placeholder="ada@example.org, grace@example.org"
              disabled={adding}
            />
          </Field>
          <Button onClick={addMembers} disabled={adding || emailsText.trim() === ''}>
            {adding ? 'Adding…' : 'Add members'}
          </Button>

          {malformed.length > 0 && (
            <p className="text-xs text-red-600">Not an email address: {malformed.join(', ')}</p>
          )}
          {addResult && addResult.added.length > 0 && (
            <div className="text-xs text-green-700">
              <p className="font-medium">Added</p>
              <ul className="list-disc pl-4 mt-1 space-y-0.5">
                {addResult.added.map((user) => (
                  <li key={user.id}>
                    {user.display_name ? `${user.display_name} (${user.email})` : user.email}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {addResult && addResult.unknown_emails.length > 0 && (
            <div className="text-xs text-yellow-800">
              <p className="font-medium">Not registered yet - invites ship in a later release.</p>
              <ul className="list-disc pl-4 mt-1 space-y-0.5">
                {addResult.unknown_emails.map((email) => (
                  <li key={email}>{email}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="surface-section">
        <h2 className="section-heading">
          Members <span className="text-neutral-400 font-normal">({members.length})</span>
        </h2>
        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <div className="overflow-x-auto border border-neutral-200 rounded-xl bg-white">
          <table className="w-full text-sm" data-testid="org-members-table">
            <thead className="bg-neutral-50/50 border-b border-neutral-200">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
                  Display name
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-neutral-500">
                    Loading members…
                  </td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-neutral-500">
                    No members yet.
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr key={member.user.id} className="hover:bg-neutral-50/60 transition-colors">
                    <td className="px-4 py-3 text-sm text-neutral-900">{member.user.email}</td>
                    <td className="px-4 py-3 text-sm text-neutral-600">
                      {member.user.display_name || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={member.is_admin ? 'brand' : 'neutral'}>
                        {member.is_admin ? 'Admin' : 'Member'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => toggleAdmin(member)}
                          disabled={busy}
                          className={`${rowActionClass} text-neutral-700 hover:bg-neutral-100`}
                        >
                          {member.is_admin ? 'Demote admin' : 'Make admin'}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeMember(member)}
                          disabled={busy}
                          className={`${rowActionClass} text-red-600 hover:bg-red-50`}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
