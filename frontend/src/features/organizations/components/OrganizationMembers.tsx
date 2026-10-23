import { Trans, useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type OrganizationUserOut } from '~/api/client';
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
import { AddByEmail } from '~/features/members/AddByEmail';
import { MembersTable, RowAction } from '~/features/members/MembersTable';
import { inviteSignupNote, PendingInvites } from '~/features/members/PendingInvites';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { extractErrorMessage } from '~/shared/utils/errorHandler';

export type OrganizationMembersProps = {
  organizationId: number;
};

const NO_MEMBERS: OrganizationUserOut[] = [];

export const OrganizationMembers = ({ organizationId }: OrganizationMembersProps) => {
  const { t } = useTranslation(['organizations', 'members']);
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);

  const queryClient = useQueryClient();
  const path = { organization_id: organizationId };

  const membersQuery = useQuery({
    ...getOrganizationUsersOptions({ path }),
    meta: { errorMessage: t('members.loadFailed'), showUser: false },
  });
  const members = membersQuery.data?.users ?? NO_MEMBERS;

  const invitesQuery = useQuery({
    ...listOrganizationInvitesOptions({ path }),
    meta: { errorMessage: t('members.loadInvitesFailed') },
  });

  const refetchMembers = () =>
    queryClient.invalidateQueries({ queryKey: getOrganizationUsersQueryKey({ path }) });
  const refetchInvites = () =>
    queryClient.invalidateQueries({ queryKey: listOrganizationInvitesQueryKey({ path }) });

  const promote = useMutation({
    ...makeOrganizationAdminMutation(),
    meta: { errorMessage: t('members.roleFailed') },
    onSuccess: refetchMembers,
  });
  const demote = useMutation({
    ...demoteOrganizationAdminMutation(),
    meta: { errorMessage: t('members.roleFailed') },
    onSuccess: refetchMembers,
  });
  const removeMemberMutation = useMutation({
    ...removeOrganizationMemberMutation(),
    meta: { errorMessage: t('members.removeFailed') },
    onSuccess: refetchMembers,
  });
  const revoke = useMutation({
    ...revokeOrganizationInviteMutation(),
    meta: { errorMessage: t('members.revokeFailed') },
    onSuccess: refetchInvites,
  });
  // An added address either becomes a member or waits as an invite, so both
  // lists below can have moved.
  const add = useMutation({
    ...addOrganizationUsersMutation(),
    meta: { errorMessage: t('members.addFailed') },
    onSuccess: () => {
      void refetchMembers();
      void refetchInvites();
    },
  });

  const busy = promote.isPending || demote.isPending || removeMemberMutation.isPending;

  const toggleAdmin = (member: OrganizationUserOut) => {
    const vars = { path: { ...path, user_id: member.user.id } };
    if (member.is_admin) demote.mutate(vars);
    else promote.mutate(vars);
  };

  const removeMember = async (member: OrganizationUserOut) => {
    const confirmed = await showConfirmDialog({
      title: t('members.confirmRemoveTitle', { name: member.user.display_name }),
      description: t('members.confirmRemoveDescription'),
      confirmText: t('members:table.remove'),
      isDangerous: true,
    });
    if (!confirmed) return;
    removeMemberMutation.mutate({ path: { ...path, user_id: member.user.id } });
  };

  return (
    <div className="surface">
      <section className="surface-section">
        <h2 className="section-heading">{t('members.addHeading')}</h2>
        <p className="section-description">
          {t('members:byEmail.description', { note: inviteSignupNote() })}
        </p>
        <div className="max-w-xl">
          <AddByEmail onAdd={(emails) => add.mutateAsync({ path, body: { emails } })} />
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
          <Trans
            t={t}
            i18nKey="members.heading"
            values={{ count: members.length }}
            components={{ count: <span className="text-neutral-400 font-normal" /> }}
          />
        </h2>
        {membersQuery.error && (
          <p className="text-xs text-red-600 mb-3">
            {extractErrorMessage(membersQuery.error, t('members.loadFailed'))}
          </p>
        )}
        {membersQuery.isPending ? (
          <p className="py-10 text-center text-sm text-neutral-500">{t('members.loading')}</p>
        ) : (
          <MembersTable
            members={members}
            emptyText={t('members.empty')}
            rowTestId="org-member-row"
            actions={(member) => (
              <>
                <RowAction onClick={() => toggleAdmin(member)} disabled={busy}>
                  {member.is_admin ? t('members.demoteAdmin') : t('members.makeAdmin')}
                </RowAction>
                <RowAction tone="danger" onClick={() => removeMember(member)} disabled={busy}>
                  {t('members:table.remove')}
                </RowAction>
              </>
            )}
          />
        )}
      </section>
    </div>
  );
};
