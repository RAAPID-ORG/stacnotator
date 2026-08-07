import { useCallback, useEffect, useRef, useState } from 'react';
import { Delayed } from '~/shared/ui/Delayed';
import { Button, Field, Input, Textarea } from '~/shared/ui/forms';
import { handleError } from '~/shared/utils/errorHandler';
import { parseEmailList, searchUsers } from '~/shared/utils/utility';
import {
  addProjectUsers,
  addProjectUsersByIds,
  demoteProjectAdmin,
  demoteProjectAuthoritativeReviewer,
  getProjectUsers,
  listProjectInvites,
  listUsers,
  makeProjectAdmin,
  makeProjectAuthoritativeReviewer,
  removeProjectUser,
  revokeProjectInvite,
  type AddUsersByEmailResult,
  type ProjectUserOut,
  type UserOut,
} from '~/api/client';
import { useLayoutStore } from '~/shared/stores/layout.store';
import {
  INVITE_SIGNUP_NOTE,
  PendingInvites,
} from '~/features/organizations/components/PendingInvites';

interface ProjectUsersSectionProps {
  projectId: number;
  canManage: boolean;
}

const userLabel = (user: UserOut) => user.display_name || user.email;

export const ProjectUsersSection = ({ projectId, canManage }: ProjectUsersSectionProps) => {
  const showAlert = useLayoutStore((state) => state.showAlert);

  const [users, setUsers] = useState<ProjectUserOut[]>([]);
  const [allUsers, setAllUsers] = useState<UserOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [selectedUserId, setSelectedUserId] = useState('');
  const [addingUser, setAddingUser] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);

  const [emailsText, setEmailsText] = useState('');
  const [addingEmails, setAddingEmails] = useState(false);
  const [emailResult, setEmailResult] = useState<AddUsersByEmailResult | null>(null);
  const [malformedEmails, setMalformedEmails] = useState<string[]>([]);
  const [invitesReload, setInvitesReload] = useState(0);

  const loadInvites = useCallback(async () => {
    const { data } = await listProjectInvites({ path: { project_id: projectId } });
    return data?.items ?? [];
  }, [projectId]);

  const handleRevokeInvite = useCallback(
    async (inviteId: number) => {
      await revokeProjectInvite({ path: { project_id: projectId, invite_id: inviteId } });
    },
    [projectId]
  );

  const loadUsers = useCallback(async () => {
    const { data } = await getProjectUsers({ path: { project_id: projectId } });
    setUsers(data?.users ?? []);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        await loadUsers();
        if (cancelled) return;
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        setLoadError(handleError(err, 'Failed to load project members', { showUser: false }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [loadUsers]);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await listUsers({});
        if (!cancelled) setAllUsers(data ?? []);
      } catch (err) {
        if (!cancelled) handleError(err, 'Failed to load users available to add');
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  useEffect(() => {
    if (!pickerOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && pickerRef.current && !pickerRef.current.contains(target)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    document
      .getElementById(`project-user-option-${activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [pickerOpen, activeIndex]);

  const refetchAfterMutation = async () => {
    try {
      await loadUsers();
    } catch (err) {
      handleError(err, 'Failed to refresh project members');
    }
  };

  const handleAddUser = async () => {
    const selectedUser = allUsers.find((u) => u.id === selectedUserId);
    if (!selectedUser) return;

    try {
      setAddingUser(true);
      await addProjectUsersByIds({
        path: { project_id: projectId },
        body: { user_ids: [selectedUser.id] },
      });
      await refetchAfterMutation();
      setSelectedUserId('');
      setUserQuery('');
      showAlert(`${userLabel(selectedUser)} added to project`, 'success');
    } catch (err) {
      handleError(err, 'Failed to add user');
    } finally {
      setAddingUser(false);
    }
  };

  const handleAddEmails = async () => {
    const { emails, invalid } = parseEmailList(emailsText);
    setMalformedEmails(invalid);
    if (emails.length === 0) {
      setEmailResult(null);
      return;
    }

    try {
      setAddingEmails(true);
      const { data } = await addProjectUsers({
        path: { project_id: projectId },
        body: { emails },
      });
      setEmailResult(data ?? null);
      setEmailsText('');
      setInvitesReload((n) => n + 1);
      await refetchAfterMutation();
    } catch (err) {
      handleError(err, 'Failed to add users by email');
    } finally {
      setAddingEmails(false);
    }
  };

  const handleToggleAdmin = async (member: ProjectUserOut) => {
    const path = { project_id: projectId, user_id: member.user.id };
    try {
      setSaving(true);
      if (member.is_admin) {
        await demoteProjectAdmin({ path });
        showAlert(`${userLabel(member.user)} demoted to member`, 'success');
      } else {
        await makeProjectAdmin({ path });
        showAlert(`${userLabel(member.user)} promoted to admin`, 'success');
      }
      await refetchAfterMutation();
    } catch (err) {
      handleError(err, 'Failed to update project role');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleReviewer = async (member: ProjectUserOut) => {
    const path = { project_id: projectId, user_id: member.user.id };
    try {
      setSaving(true);
      if (member.is_authoritative_reviewer) {
        await demoteProjectAuthoritativeReviewer({ path });
        showAlert(`${userLabel(member.user)} removed as authoritative reviewer`, 'success');
      } else {
        await makeProjectAuthoritativeReviewer({ path });
        showAlert(`${userLabel(member.user)} is now an authoritative reviewer`, 'success');
      }
      await refetchAfterMutation();
    } catch (err) {
      handleError(err, 'Failed to update reviewer status');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveUser = async (member: ProjectUserOut) => {
    if (!window.confirm(`Remove ${userLabel(member.user)} from this project?`)) return;

    try {
      setSaving(true);
      await removeProjectUser({
        path: { project_id: projectId, user_id: member.user.id },
      });
      await refetchAfterMutation();
      showAlert(`${userLabel(member.user)} removed from project`, 'success');
    } catch (err) {
      handleError(err, 'Failed to remove user');
    } finally {
      setSaving(false);
    }
  };

  const availableUsers = allUsers.filter((u) => !users.some((pu) => pu.user.id === u.id));

  // Once a user is picked the input holds their label; ignore it as a filter
  // so reopening the picker shows the full list again.
  const matchingUsers = searchUsers(availableUsers, (u) => u, selectedUserId ? '' : userQuery);
  const activeUserIndex = Math.min(activeIndex, Math.max(matchingUsers.length - 1, 0));

  const pickUser = (user: UserOut) => {
    setSelectedUserId(user.id);
    setUserQuery(`${userLabel(user)} (${user.email})`);
    setPickerOpen(false);
  };

  if (loading) {
    return (
      <Delayed>
        <div className="flex items-center justify-center py-12">
          <p className="text-neutral-500">Loading members...</p>
        </div>
      </Delayed>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-red-600">{loadError}</p>
      </div>
    );
  }

  const rowActionCls =
    'inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const sectionCls =
    'space-y-4 pt-6 mt-6 first:mt-0 first:pt-0 border-t border-neutral-100 first:border-t-0';

  return (
    <div>
      {canManage && (
        <>
          <section className={sectionCls}>
            <div>
              <h2 className="section-heading">Add member</h2>
              <p className="section-description">
                Add a platform user to this project. Project members can be assigned tasks and roles
                in the project&apos;s campaigns.
              </p>
            </div>
            <div className="flex gap-3 items-end">
              <Field label="Select user" htmlFor="project-user-search" className="flex-1">
                <div className="relative" ref={pickerRef}>
                  <Input
                    id="project-user-search"
                    role="combobox"
                    aria-expanded={pickerOpen}
                    aria-controls="project-user-listbox"
                    aria-autocomplete="list"
                    aria-activedescendant={
                      pickerOpen && matchingUsers.length > 0
                        ? `project-user-option-${activeUserIndex}`
                        : undefined
                    }
                    value={userQuery}
                    onChange={(e) => {
                      setUserQuery(e.target.value);
                      setSelectedUserId('');
                      setActiveIndex(0);
                      setPickerOpen(true);
                    }}
                    onFocus={() => setPickerOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setPickerOpen(false);
                      } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        if (pickerOpen) {
                          setActiveIndex(Math.min(activeUserIndex + 1, matchingUsers.length - 1));
                        } else {
                          setPickerOpen(true);
                        }
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setActiveIndex(Math.max(activeUserIndex - 1, 0));
                      } else if (
                        e.key === 'Enter' &&
                        pickerOpen &&
                        matchingUsers[activeUserIndex]
                      ) {
                        e.preventDefault();
                        pickUser(matchingUsers[activeUserIndex]);
                      }
                    }}
                    placeholder={
                      availableUsers.length === 0
                        ? 'No users available'
                        : 'Search by name or email…'
                    }
                    disabled={addingUser || availableUsers.length === 0}
                  />
                  {pickerOpen && availableUsers.length > 0 && (
                    <div
                      id="project-user-listbox"
                      role="listbox"
                      className="absolute z-20 mt-1 w-full bg-white border border-neutral-300 rounded-lg shadow-lg max-h-64 overflow-y-auto"
                    >
                      {matchingUsers.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-neutral-500">
                          No users match your search
                        </p>
                      ) : (
                        matchingUsers.map((user, index) => (
                          <button
                            key={user.id}
                            id={`project-user-option-${index}`}
                            role="option"
                            aria-selected={user.id === selectedUserId}
                            type="button"
                            onClick={() => pickUser(user)}
                            onMouseEnter={() => setActiveIndex(index)}
                            className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                              index === activeUserIndex ? 'bg-brand-50' : ''
                            } ${user.id === selectedUserId ? 'text-brand-800' : 'text-neutral-900'}`}
                          >
                            <div className="font-medium">{userLabel(user)}</div>
                            <div className="text-neutral-500">{user.email}</div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </Field>
              <Button onClick={handleAddUser} disabled={addingUser || !selectedUserId}>
                {addingUser ? 'Adding…' : 'Add member'}
              </Button>
            </div>
          </section>

          <section className={sectionCls}>
            <div>
              <h2 className="section-heading">Add by email</h2>
              <p className="section-description">
                Paste one or more email addresses, separated by commas, spaces or newlines.
                Addresses without an account yet are invited automatically. {INVITE_SIGNUP_NOTE}
              </p>
            </div>
            <Field label="Email addresses" htmlFor="member-emails-input">
              <Textarea
                id="member-emails-input"
                data-testid="member-emails-input"
                value={emailsText}
                onChange={(e) => setEmailsText(e.target.value)}
                placeholder="ada@example.org, grace@example.org"
                disabled={addingEmails}
              />
            </Field>
            <div>
              <Button
                data-testid="member-emails-submit"
                onClick={handleAddEmails}
                disabled={addingEmails || emailsText.trim() === ''}
              >
                {addingEmails ? 'Adding…' : 'Add by email'}
              </Button>
            </div>
            {(malformedEmails.length > 0 || emailResult) && (
              <div className="space-y-2 text-xs">
                {malformedEmails.length > 0 && (
                  <div
                    data-testid="add-result-malformed"
                    className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700"
                  >
                    Not an email address: {malformedEmails.join(', ')}
                  </div>
                )}
                {emailResult && emailResult.added.length > 0 && (
                  <div
                    data-testid="add-result-added"
                    className="px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-green-800"
                  >
                    Added {emailResult.added.length} member
                    {emailResult.added.length === 1 ? '' : 's'}:{' '}
                    {emailResult.added.map((u) => u.email).join(', ')}
                  </div>
                )}
                {emailResult && emailResult.invited_emails.length > 0 && (
                  <div
                    data-testid="add-result-invited"
                    className="px-3 py-2 rounded-lg bg-brand-50 border border-brand-200 text-brand-800"
                  >
                    Invited {emailResult.invited_emails.join(', ')}. {INVITE_SIGNUP_NOTE}
                  </div>
                )}
              </div>
            )}
            <PendingInvites
              listInvites={loadInvites}
              revokeInvite={handleRevokeInvite}
              reloadKey={invitesReload}
            />
          </section>
        </>
      )}

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">
            Project members <span className="text-neutral-400 font-normal">({users.length})</span>
          </h2>
        </div>

        {users.length === 0 ? (
          <div className="text-center py-10 text-sm text-neutral-500">
            No members in this project yet.
          </div>
        ) : (
          <div className="overflow-x-auto border border-neutral-200 rounded-xl bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50/50 border-b border-neutral-200">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
                    Role
                  </th>
                  {canManage && (
                    <th className="px-4 py-3 text-right text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {users.map((member) => (
                  <tr
                    key={member.user.id}
                    data-testid="project-member-row"
                    className="hover:bg-neutral-50/60 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-neutral-900">
                      {userLabel(member.user)}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">{member.user.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full border ${
                            member.is_admin
                              ? 'bg-brand-50 text-brand-800 border-brand-200'
                              : 'bg-neutral-50 text-neutral-700 border-neutral-200'
                          }`}
                        >
                          {member.is_admin ? 'Admin' : 'Member'}
                        </span>
                        {member.is_authoritative_reviewer && (
                          <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full bg-accent-50 text-accent-800 border border-accent-200">
                            Authoritative reviewer
                          </span>
                        )}
                      </div>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5 flex-wrap">
                          <button
                            onClick={() => handleToggleAdmin(member)}
                            disabled={saving}
                            className={`${rowActionCls} text-neutral-700 hover:bg-neutral-100`}
                            type="button"
                          >
                            {member.is_admin ? 'Revoke admin' : 'Make admin'}
                          </button>
                          <button
                            onClick={() => handleToggleReviewer(member)}
                            disabled={saving}
                            className={`${rowActionCls} text-accent-700 hover:bg-accent-50`}
                            type="button"
                          >
                            {member.is_authoritative_reviewer
                              ? 'Remove auth. reviewer'
                              : 'Make auth. reviewer'}
                          </button>
                          <button
                            onClick={() => handleRemoveUser(member)}
                            disabled={saving}
                            className={`${rowActionCls} text-red-600 hover:bg-red-50`}
                            type="button"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
