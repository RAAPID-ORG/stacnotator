import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AddUsersByEmailResult, type OrganizationUserOut } from '~/api/client';
import {
  addOrganizationUsersMutation,
  demoteOrganizationAdminMutation,
  getOrganizationUsersOptions,
  getOrganizationUsersQueryKey,
  listOrganizationInvitesOptions,
  listOrganizationInvitesQueryKey,
  makeOrganizationAdminMutation,
  removeOrganizationMemberMutation,
  revokeOrganizationInviteMutation,
} from '~/api/queries';
import { useAccountStore } from '~/shared/stores/account.store';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Badge } from '~/shared/ui/Badge';
import { Button, Field, Textarea } from '~/shared/ui/forms';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { parseEmailList } from '~/shared/utils/utility';
import { INVITE_SIGNUP_NOTE, PendingInvites } from './PendingInvites';

export type OrganizationMembersProps = {
  organizationId: number;
};

const NO_MEMBERS: OrganizationUserOut[] = [];

const rowActionClass =
  'inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

export const OrganizationMembers = ({ organizationId }: OrganizationMembersProps) => {
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);
  // Emails only reach platform admins; everyone else manages members by name.
  const showEmails = useAccountStore((s) => s.account?.is_admin ?? false);

  const queryClient = useQueryClient();
  const path = { organization_id: organizationId };

  const [emailsText, setEmailsText] = useState('');
  const [addResult, setAddResult] = useState<AddUsersByEmailResult | null>(null);
  const [malformed, setMalformed] = useState<string[]>([]);

  const membersQuery = useQuery({
    ...getOrganizationUsersOptions({ path }),
    meta: { errorMessage: 'Failed to load organization members', showUser: false },
  });
  const members = membersQuery.data?.users ?? NO_MEMBERS;

  const invitesQuery = useQuery({
    ...listOrganizationInvitesOptions({ path }),
    meta: { errorMessage: 'Failed to load pending signups' },
  });

  const refetchMembers = () =>
    queryClient.invalidateQueries({ queryKey: getOrganizationUsersQueryKey({ path }) });
  const refetchInvites = () =>
    queryClient.invalidateQueries({ queryKey: listOrganizationInvitesQueryKey({ path }) });

  const promote = useMutation({
    ...makeOrganizationAdminMutation(),
    meta: { errorMessage: 'Failed to update member role' },
    onSuccess: refetchMembers,
  });
  const demote = useMutation({
    ...demoteOrganizationAdminMutation(),
    meta: { errorMessage: 'Failed to update member role' },
    onSuccess: refetchMembers,
  });
  const removeMemberMutation = useMutation({
    ...removeOrganizationMemberMutation(),
    meta: { errorMessage: 'Failed to remove member' },
    onSuccess: refetchMembers,
  });
  const revoke = useMutation({
    ...revokeOrganizationInviteMutation(),
    meta: { errorMessage: 'Failed to revoke invite' },
    onSuccess: refetchInvites,
  });
  // An added address either becomes a member or waits as an invite, so both
  // lists below can have moved.
  const add = useMutation({
    ...addOrganizationUsersMutation(),
    meta: { errorMessage: 'Failed to add members' },
    onSuccess: (result) => {
      setAddResult(result);
      setEmailsText('');
      void refetchMembers();
      void refetchInvites();
    },
  });

  const loading = membersQuery.isPending;
  const adding = add.isPending;
  const busy = promote.isPending || demote.isPending || removeMemberMutation.isPending;

  const toggleAdmin = (member: OrganizationUserOut) => {
    const vars = { path: { ...path, user_id: member.user.id } };
    if (member.is_admin) demote.mutate(vars);
    else promote.mutate(vars);
  };

  const removeMember = async (member: OrganizationUserOut) => {
    const confirmed = await showConfirmDialog({
      title: `Remove ${member.user.display_name}?`,
      description: 'They lose access to this organization and its projects.',
      confirmText: 'Remove',
      isDangerous: true,
    });
    if (!confirmed) return;
    removeMemberMutation.mutate({ path: { ...path, user_id: member.user.id } });
  };

  const addMembers = () => {
    const { emails, invalid } = parseEmailList(emailsText);
    setMalformed(invalid);
    if (emails.length === 0) {
      setAddResult(null);
      return;
    }
    add.mutate({ path, body: { emails } });
  };

  return (
    <div className="surface">
      <section className="surface-section">
        <h2 className="section-heading">Add members</h2>
        <p className="section-description">
          Invite users that are not yet registered on STACNotator. Paste one or more email
          addresses, separated by commas, spaces or newlines. Addresses without an account yet, will
          be automatically added to the project when signing up to STACNotator. {INVITE_SIGNUP_NOTE}
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
                    {user.email ? `${user.display_name} (${user.email})` : user.display_name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {addResult && addResult.invited_emails.length > 0 && (
            <div
              data-testid="add-result-invited"
              className="text-xs px-3 py-2 rounded-lg bg-brand-50 border border-brand-200 text-brand-800"
            >
              <p className="font-medium">Invited</p>
              <ul className="list-disc pl-4 mt-1 space-y-0.5">
                {addResult.invited_emails.map((email) => (
                  <li key={email}>{email}</li>
                ))}
              </ul>
              <p className="mt-1">{INVITE_SIGNUP_NOTE}</p>
            </div>
          )}
        </div>
        <PendingInvites
          invites={invitesQuery.data?.items ?? []}
          onRevoke={(invite) => revoke.mutate({ path: { ...path, invite_id: invite.id } })}
          revokingId={revoke.isPending ? (revoke.variables.path.invite_id ?? null) : null}
          className="mt-6 max-w-xl"
        />
      </section>

      <section className="surface-section">
        <h2 className="section-heading">
          Members <span className="text-neutral-400 font-normal">({members.length})</span>
        </h2>
        {membersQuery.error && (
          <p className="text-xs text-red-600 mb-3">
            {extractErrorMessage(membersQuery.error, 'Failed to load organization members')}
          </p>
        )}

        <div className="overflow-x-auto border border-neutral-200 rounded-xl bg-white">
          <table className="w-full text-sm" data-testid="org-members-table">
            <thead className="bg-neutral-50/50 border-b border-neutral-200">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
                  Name
                </th>
                {showEmails && (
                  <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
                    Email
                  </th>
                )}
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
                  <td
                    colSpan={showEmails ? 4 : 3}
                    className="px-4 py-10 text-center text-sm text-neutral-500"
                  >
                    Loading members…
                  </td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td
                    colSpan={showEmails ? 4 : 3}
                    className="px-4 py-10 text-center text-sm text-neutral-500"
                  >
                    No members yet.
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr key={member.user.id} className="hover:bg-neutral-50/60 transition-colors">
                    <td className="px-4 py-3 text-sm text-neutral-900">
                      {member.user.display_name}
                    </td>
                    {showEmails && (
                      <td className="px-4 py-3 text-sm text-neutral-600">{member.user.email}</td>
                    )}
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
