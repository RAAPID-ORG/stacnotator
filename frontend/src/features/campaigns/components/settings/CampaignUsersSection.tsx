import { useEffect, useState } from 'react';
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
        <p className="text-gray-500">Loading users...</p>
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

  return (
    <div className="space-y-8">
      {/* Add User Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-brand-800 mb-4">Add New User</h2>

        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">Select User</label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
              disabled={addingUser || availableUsers.length === 0}
            >
              <option value="">
                {availableUsers.length === 0 ? 'No users available' : 'Select a user...'}
              </option>
              {availableUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name} ({user.email})
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleAddUser}
            disabled={addingUser || !selectedUserId}
            className="px-4 py-2 bg-brand-500 text-white rounded hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            type="button"
          >
            {addingUser ? 'Adding...' : 'Add User'}
          </button>
        </div>
      </div>

      {/* Users List */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-brand-800 mb-4">Campaign Users</h2>

        {users.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-sm">No users assigned to this campaign yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Email</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Role</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.user.id}
                    className="border-b border-gray-200 hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3 text-gray-900 font-medium">
                      {user.user.display_name}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{user.user.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                            user.is_admin
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {user.is_admin ? 'Admin' : 'Member'}
                        </span>
                        {user.is_authorative_reviewer && (
                          <span className="inline-block px-2 py-1 rounded text-xs font-medium bg-indigo-100 text-indigo-800">
                            Authoritative Reviewer
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => handleToggleAdmin(user)}
                          disabled={saving}
                          className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          type="button"
                        >
                          {user.is_admin ? 'Revoke Admin' : 'Make Admin'}
                        </button>
                        <button
                          onClick={() => handleToggleAuthorativeReviewer(user)}
                          disabled={saving}
                          className="text-xs px-2 py-1 border border-indigo-300 text-indigo-600 rounded hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          type="button"
                        >
                          {user.is_authorative_reviewer
                            ? 'Remove Authoritative Reviewer'
                            : 'Make Authoritative Reviewer'}
                        </button>
                        <button
                          onClick={() => handleRemoveUser(user)}
                          disabled={saving}
                          className="text-xs px-2 py-1 text-red-600 border border-red-300 rounded hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
      </div>
    </div>
  );
};
