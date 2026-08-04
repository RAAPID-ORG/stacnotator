import { useEffect, useRef, useState } from 'react';
import { Button, Field, Input } from '~/shared/ui/forms';
import { handleError } from '~/shared/utils/errorHandler';
import { searchUsers } from '~/shared/utils/utility';
import {
  addUsersToCampaign,
  getCampaignUsers,
  listUsers,
  makeUserCampaignAdmin,
  demoteCampaignAdmin,
  makeUserAuthorativeReviewer,
  demoteAuthorativeReviewer,
  removeUserFromCampaign,
  type CampaignUserOut,
  type UserOutDetailed,
} from '~/api/client';

interface CampaignUsersSectionProps {
  campaignId: number;
  onError?: (error: string) => void;
  onSuccess?: (message: string) => void;
}

export const CampaignUsersSection = ({
  campaignId,
  onError,
  onSuccess,
}: CampaignUsersSectionProps) => {
  const [users, setUsers] = useState<CampaignUserOut[]>([]);
  const [allUsers, setAllUsers] = useState<UserOutDetailed[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [selectedUserId, setSelectedUserId] = useState('');
  const [addingUser, setAddingUser] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    document
      .getElementById(`campaign-user-option-${activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [pickerOpen, activeIndex]);

  useEffect(() => {
    loadUsers();
    loadAllUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadUsers/loadAllUsers are stable callbacks that depend on campaignId
  }, [campaignId]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const { data } = await getCampaignUsers({ path: { campaign_id: campaignId } });
      setUsers(data!.users);
    } catch (err) {
      handleError(err, 'Failed to load campaign users', { showUser: false });
      setError('Failed to load campaign users');
    } finally {
      setLoading(false);
    }
  };

  const loadAllUsers = async () => {
    try {
      const { data } = await listUsers({});
      setAllUsers(data || []);
    } catch (err) {
      const message = handleError(err, 'Failed to load users available to add', {
        showUser: false,
      });
      onError?.(message);
    }
  };

  const handleAddUser = async () => {
    if (!selectedUserId) {
      const msg = 'Please select a user';
      setError(msg);
      onError?.(msg);
      return;
    }

    const selectedUser = allUsers.find((u) => u.id === selectedUserId);
    if (!selectedUser) {
      const msg = 'Selected user not found';
      setError(msg);
      onError?.(msg);
      return;
    }

    try {
      setAddingUser(true);
      await addUsersToCampaign({
        path: { campaign_id: campaignId },
        body: { user_ids: [selectedUser.id] },
      });

      // Reload users to get the updated list with the new user
      await loadUsers();

      setSelectedUserId('');
      setUserQuery('');
      const msg = `${selectedUser.display_name} added to campaign`;
      onSuccess?.(msg);
    } catch (err) {
      const message = handleError(err, 'Failed to add user. Please try again.', {
        showUser: false,
      });
      setError(message);
      onError?.(message);
    } finally {
      setAddingUser(false);
    }
  };

  const handleToggleAdmin = async (user: CampaignUserOut) => {
    try {
      setSaving(true);

      if (user.is_admin) {
        // Demote admin to member
        await demoteCampaignAdmin({
          path: { campaign_id: campaignId },
          query: { user_id: user.user.id },
        });

        const msg = `${user.user.display_name} demoted to member`;
        onSuccess?.(msg);
      } else {
        // Make user admin
        await makeUserCampaignAdmin({
          path: { campaign_id: campaignId },
          query: { new_admin_user_id: user.user.id },
        });

        const msg = `${user.user.display_name} promoted to admin`;
        onSuccess?.(msg);
      }

      // Reload users to get updated state
      await loadUsers();
    } catch (err) {
      const message = handleError(err, 'Failed to update user role', { showUser: false });
      setError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAuthorativeReviewer = async (user: CampaignUserOut) => {
    try {
      setSaving(true);

      if (user.is_authorative_reviewer) {
        // Demote from authoritative reviewer
        await demoteAuthorativeReviewer({
          path: { campaign_id: campaignId },
          query: { user_id: user.user.id },
        });

        const msg = `${user.user.display_name} removed as authoritative reviewer`;
        onSuccess?.(msg);
      } else {
        // Make user authoritative reviewer
        await makeUserAuthorativeReviewer({
          path: { campaign_id: campaignId },
          query: { new_authorative_reviewer_id: user.user.id },
        });

        const msg = `${user.user.display_name} is now an authoritative reviewer`;
        onSuccess?.(msg);
      }

      // Reload users to get updated state
      await loadUsers();
    } catch (err) {
      const message = handleError(err, 'Failed to update reviewer status', { showUser: false });
      setError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveUser = async (user: CampaignUserOut) => {
    if (!window.confirm(`Are you sure you want to remove ${user.user.display_name}?`)) return;

    try {
      setSaving(true);

      await removeUserFromCampaign({
        path: {
          campaign_id: campaignId,
          user_id: user.user.id,
        },
      });

      // Update local state
      setUsers(users.filter((u) => u.user.id !== user.user.id));

      const msg = `${user.user.display_name} removed from campaign`;
      onSuccess?.(msg);
    } catch (err) {
      const message = handleError(err, 'Failed to remove user', { showUser: false });
      setError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  };

  // Filter out users already in the campaign
  const availableUsers = allUsers.filter((u) => !users.some((cu) => cu.user.id === u.id));

  // Once a user is picked the input holds their label; ignore it as a filter
  // so reopening the picker shows the full list again.
  const matchingUsers = searchUsers(availableUsers, (u) => u, selectedUserId ? '' : userQuery);
  const activeUserIndex = Math.min(activeIndex, Math.max(matchingUsers.length - 1, 0));

  const pickUser = (user: UserOutDetailed) => {
    setSelectedUserId(user.id);
    setUserQuery(`${user.display_name} (${user.email})`);
    setPickerOpen(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-neutral-500">Loading users...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  // Inline compact action button - consistent with PlatformUsersTable.
  const rowActionCls =
    'inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const sectionCls =
    'space-y-4 pt-6 mt-6 first:mt-0 first:pt-0 border-t border-neutral-100 first:border-t-0';

  return (
    <div>
      {/* Add user */}
      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">Add user</h2>
          <p className="section-description">
            Add a platform user to this campaign. They can then be assigned tasks and roles.
          </p>
        </div>
        <div className="flex gap-3 items-end">
          <Field label="Select user" htmlFor="campaign-user-search" className="flex-1">
            <div className="relative" ref={pickerRef}>
              <Input
                id="campaign-user-search"
                role="combobox"
                aria-expanded={pickerOpen}
                aria-controls="campaign-user-listbox"
                aria-autocomplete="list"
                aria-activedescendant={
                  pickerOpen && matchingUsers.length > 0
                    ? `campaign-user-option-${activeUserIndex}`
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
                  } else if (e.key === 'Enter' && pickerOpen && matchingUsers[activeUserIndex]) {
                    e.preventDefault();
                    pickUser(matchingUsers[activeUserIndex]);
                  }
                }}
                placeholder={
                  availableUsers.length === 0 ? 'No users available' : 'Search by name or email…'
                }
                disabled={addingUser || availableUsers.length === 0}
              />
              {pickerOpen && availableUsers.length > 0 && (
                <div
                  id="campaign-user-listbox"
                  role="listbox"
                  className="absolute z-20 mt-1 w-full bg-white border border-neutral-300 rounded-lg shadow-lg max-h-64 overflow-y-auto"
                >
                  {matchingUsers.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-neutral-500">No users match your search</p>
                  ) : (
                    matchingUsers.map((user, index) => (
                      <button
                        key={user.id}
                        id={`campaign-user-option-${index}`}
                        role="option"
                        aria-selected={user.id === selectedUserId}
                        type="button"
                        onClick={() => pickUser(user)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                          index === activeUserIndex ? 'bg-brand-50' : ''
                        } ${user.id === selectedUserId ? 'text-brand-800' : 'text-neutral-900'}`}
                      >
                        <div className="font-medium">{user.display_name}</div>
                        <div className="text-neutral-500">{user.email}</div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </Field>
          <Button onClick={handleAddUser} disabled={addingUser || !selectedUserId}>
            {addingUser ? 'Adding…' : 'Add user'}
          </Button>
        </div>
      </section>

      {/* Users list */}
      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">
            Campaign users <span className="text-neutral-400 font-normal">({users.length})</span>
          </h2>
        </div>

        {users.length === 0 ? (
          <div className="text-center py-10 text-sm text-neutral-500">
            No users assigned to this campaign yet.
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
                  <th className="px-4 py-3 text-right text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {users.map((user) => (
                  <tr key={user.user.id} className="hover:bg-neutral-50/60 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-neutral-900">
                      {user.user.display_name}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">{user.user.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full border ${
                            user.is_admin
                              ? 'bg-brand-50 text-brand-800 border-brand-200'
                              : 'bg-neutral-50 text-neutral-700 border-neutral-200'
                          }`}
                        >
                          {user.is_admin ? 'Admin' : 'Member'}
                        </span>
                        {user.is_authorative_reviewer && (
                          <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full bg-accent-50 text-accent-800 border border-accent-200">
                            Authoritative reviewer
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5 flex-wrap">
                        <button
                          onClick={() => handleToggleAdmin(user)}
                          disabled={saving}
                          className={`${rowActionCls} text-neutral-700 hover:bg-neutral-100`}
                          type="button"
                        >
                          {user.is_admin ? 'Revoke admin' : 'Make admin'}
                        </button>
                        <button
                          onClick={() => handleToggleAuthorativeReviewer(user)}
                          disabled={saving}
                          className={`${rowActionCls} text-accent-700 hover:bg-accent-50`}
                          type="button"
                        >
                          {user.is_authorative_reviewer
                            ? 'Remove auth. reviewer'
                            : 'Make auth. reviewer'}
                        </button>
                        <button
                          onClick={() => handleRemoveUser(user)}
                          disabled={saving}
                          className={`${rowActionCls} text-red-600 hover:bg-red-50`}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
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
