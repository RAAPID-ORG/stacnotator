import { Trans, useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Delayed } from '~/shared/ui/Delayed';
import { Badge } from '~/shared/ui/Badge';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { type ProjectUserOut } from '~/api/client';
import {
  addProjectUsersMutation,
  demoteProjectAdminMutation,
  demoteProjectAuthoritativeReviewerMutation,
  getProjectUsersOptions,
  getProjectUsersQueryKey,
  listProjectInvitesOptions,
  listProjectInvitesQueryKey,
  makeProjectAdminMutation,
  makeProjectAuthoritativeReviewerMutation,
  removeProjectUserMutation,
  revokeProjectInviteMutation,
} from '~/api/queries';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { AddByEmail } from '~/features/members/AddByEmail';
import { MembersTable, RowAction } from '~/features/members/MembersTable';
import { inviteSignupNote, PendingInvites } from '~/features/members/PendingInvites';
import { AddPlatformUser } from './AddPlatformUser';

interface ProjectUsersSectionProps {
  projectId: number;
  canManage: boolean;
}

const NO_MEMBERS: ProjectUserOut[] = [];

export const ProjectUsersSection = ({ projectId, canManage }: ProjectUsersSectionProps) => {
  const { t } = useTranslation(['projects', 'members']);
  const showAlert = useLayoutStore((state) => state.showAlert);

  const queryClient = useQueryClient();
  const path = { project_id: projectId };

  const membersQuery = useQuery({
    ...getProjectUsersOptions({ path }),
    meta: { errorMessage: t('members.loadFailed'), showUser: false },
  });
  const users = membersQuery.data?.users ?? NO_MEMBERS;
  const loading = membersQuery.isPending;

  const invitesQuery = useQuery({
    ...listProjectInvitesOptions({ path }),
    meta: { errorMessage: t('members.loadInvitesFailed') },
  });

  const refetchMembers = () =>
    queryClient.invalidateQueries({ queryKey: getProjectUsersQueryKey({ path }) });
  const refetchInvites = () =>
    queryClient.invalidateQueries({ queryKey: listProjectInvitesQueryKey({ path }) });

  // An added address either becomes a member or waits as an invite.
  const addByEmail = useMutation({
    ...addProjectUsersMutation(),
    meta: { errorMessage: t('members.addByEmailFailed') },
    onSuccess: () => {
      void refetchMembers();
      void refetchInvites();
    },
  });
  const promote = useMutation({
    ...makeProjectAdminMutation(),
    meta: { errorMessage: t('members.roleFailed') },
    onSuccess: refetchMembers,
  });
  const demote = useMutation({
    ...demoteProjectAdminMutation(),
    meta: { errorMessage: t('members.roleFailed') },
    onSuccess: refetchMembers,
  });
  const addReviewer = useMutation({
    ...makeProjectAuthoritativeReviewerMutation(),
    meta: { errorMessage: t('members.reviewerFailed') },
    onSuccess: refetchMembers,
  });
  const dropReviewer = useMutation({
    ...demoteProjectAuthoritativeReviewerMutation(),
    meta: { errorMessage: t('members.reviewerFailed') },
    onSuccess: refetchMembers,
  });
  const removeUser = useMutation({
    ...removeProjectUserMutation(),
    meta: { errorMessage: t('members.removeFailed') },
    onSuccess: refetchMembers,
  });
  const revokeInvite = useMutation({
    ...revokeProjectInviteMutation(),
    meta: { errorMessage: t('members.revokeFailed') },
    onSuccess: refetchInvites,
  });

  const saving =
    promote.isPending ||
    demote.isPending ||
    addReviewer.isPending ||
    dropReviewer.isPending ||
    removeUser.isPending;

  const handleToggleAdmin = (member: ProjectUserOut) => {
    const vars = { path: { ...path, user_id: member.user.id } };
    const name = member.user.display_name;
    if (member.is_admin) {
      demote.mutate(vars, {
        onSuccess: () => showAlert(t('members.demoted', { name }), 'success'),
      });
    } else {
      promote.mutate(vars, {
        onSuccess: () => showAlert(t('members.promoted', { name }), 'success'),
      });
    }
  };

  const handleToggleReviewer = (member: ProjectUserOut) => {
    const vars = { path: { ...path, user_id: member.user.id } };
    const name = member.user.display_name;
    if (member.is_authoritative_reviewer) {
      dropReviewer.mutate(vars, {
        onSuccess: () => showAlert(t('members.reviewerRemoved', { name }), 'success'),
      });
    } else {
      addReviewer.mutate(vars, {
        onSuccess: () => showAlert(t('members.reviewerAdded', { name }), 'success'),
      });
    }
  };

  const handleRemoveUser = async (member: ProjectUserOut) => {
    const confirmed = await useLayoutStore.getState().showConfirmDialog({
      title: t('members.confirmRemove', { name: member.user.display_name }),
      confirmText: t('members:table.remove'),
      isDangerous: true,
    });
    if (!confirmed) return;
    removeUser.mutate(
      { path: { ...path, user_id: member.user.id } },
      {
        onSuccess: () =>
          showAlert(t('members.removed', { name: member.user.display_name }), 'success'),
      }
    );
  };

  if (loading) {
    return (
      <Delayed>
        <div className="flex items-center justify-center py-12">
          <p className="text-neutral-500">{t('members.loading')}</p>
        </div>
      </Delayed>
    );
  }

  if (membersQuery.error) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-red-600">
          {extractErrorMessage(membersQuery.error, t('members.loadFailed'))}
        </p>
      </div>
    );
  }

  const sectionCls =
    'space-y-4 pt-6 mt-6 first:mt-0 first:pt-0 border-t border-neutral-100 first:border-t-0';

  return (
    <div>
      {canManage && (
        <>
          <section className={sectionCls}>
            <div>
              <h2 className="section-heading">{t('members.addHeading')}</h2>
              <p className="section-description">{t('members.addDescription')}</p>
            </div>
            <AddPlatformUser projectId={projectId} members={users} onAdded={refetchMembers} />
          </section>

          <section className={sectionCls}>
            <div>
              <h2 className="section-heading">{t('members.inviteHeading')}</h2>
              <p className="section-description">
                {t('members:byEmail.description', { note: inviteSignupNote() })}
              </p>
            </div>
            <AddByEmail onAdd={(emails) => addByEmail.mutateAsync({ path, body: { emails } })} />
            <PendingInvites
              invites={invitesQuery.data?.items ?? []}
              onRevoke={(invite) =>
                revokeInvite.mutate({ path: { ...path, invite_id: invite.id } })
              }
              revokingId={
                revokeInvite.isPending ? (revokeInvite.variables.path.invite_id ?? null) : null
              }
            />
          </section>
        </>
      )}

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">
            <Trans
              t={t}
              i18nKey="members.heading"
              values={{ count: users.length }}
              components={{ count: <span className="text-neutral-400 font-normal" /> }}
            />
          </h2>
        </div>
        <MembersTable
          members={users}
          emptyText={t('members.empty')}
          rowTestId="project-member-row"
          extraRoles={(member) =>
            member.is_authoritative_reviewer && (
              <Badge tone="accent">{t('members.authoritativeReviewer')}</Badge>
            )
          }
          actions={
            canManage
              ? (member) => (
                  <>
                    <RowAction onClick={() => handleToggleAdmin(member)} disabled={saving}>
                      {member.is_admin ? t('members.revokeAdmin') : t('members.makeAdmin')}
                    </RowAction>
                    <RowAction
                      tone="accent"
                      onClick={() => handleToggleReviewer(member)}
                      disabled={saving}
                    >
                      {member.is_authoritative_reviewer
                        ? t('members.removeReviewer')
                        : t('members.makeReviewer')}
                    </RowAction>
                    <RowAction
                      tone="danger"
                      onClick={() => handleRemoveUser(member)}
                      disabled={saving}
                    >
                      {t('members:table.remove')}
                    </RowAction>
                  </>
                )
              : undefined
          }
        />
      </section>
    </div>
  );
};
