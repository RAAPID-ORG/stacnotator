import { useEffect, useState } from 'react';
import { Button, Field, Select } from '~/shared/ui/forms';
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
      console.error(err);
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
      console.error(err);
      // Don't set error state, just log - this is a secondary feature
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
      const msg = `${selectedUser.display_name} added to campaign`;
      onSuccess?.(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add user. Please try again.';
      setError(message);
      onError?.(message);
      console.error(err);
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
      const message = err instanceof Error ? err.message : 'Failed to update user role';
      setError(message);
      onError?.(message);
      console.error(err);
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
      const message = err instanceof Error ? err.message : 'Failed to update reviewer status';
      setError(message);
      onError?.(message);
      console.error(err);
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
      const message = err instanceof Error ? err.message : 'Failed to remove user';
      setError(message);
      onError?.(message);
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  // Filter out users already in the campaign
  const availableUsers = allUsers.filter((u) => !users.some((cu) => cu.user.id === u.id));

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
          <Field label="Select user" className="flex-1">
            <Select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              disabled={addingUser || availableUsers.length === 0}
            >
              <option value="">
                {availableUsers.length === 0 ? 'No users available' : 'Select a user…'}
              </option>
              {availableUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name} ({user.email})
                </option>
              ))}
            </Select>
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
