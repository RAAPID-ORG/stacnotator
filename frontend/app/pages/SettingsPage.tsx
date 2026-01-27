import { useEffect, useState } from 'react';
import { PlatformUsersTable } from '~/components/settings/PlatformUsersTable';
import { LoadingSpinner } from '~/components/shared/LoadingSpinner';
import { LoadingOverlay } from '~/components/shared/LoadingOverlay';
import { useUIStore } from '~/stores/uiStore';
import { useUserStore } from '~/stores/userStore';
import {
  listUsers,
  approveUsersBulk,
  revokeUsersBulk,
  denyUsersBulk,
  grantAdmin,
  revokeAdmin,
  editUserInfo,
  type UserOutDetailed,
} from '~/api/client';

export const SettingsPage = () => {
  const [activeTab, setActiveTab] = useState<'profile' | 'users'>('profile');
  const [users, setUsers] = useState<UserOutDetailed[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Display name editing state
  const [isEditingDisplayName, setIsEditingDisplayName] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState('');

  const setBreadcrumbs = useUIStore((state) => state.setBreadcrumbs);
  const showAlert = useUIStore((state) => state.showAlert);
  const { currentUser, updateCurrentUser, isLoading: userLoading } = useUserStore();

  // Set breadcrumbs
  useEffect(() => {
    setBreadcrumbs([{ label: 'Settings' }]);
  }, [setBreadcrumbs]);

  // Load users when switching to users tab (if admin)
  useEffect(() => {
    if (activeTab === 'users' && currentUser?.is_admin && users.length === 0) {
      loadUsers();
    }
  }, [activeTab, currentUser]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const { data } = await listUsers();
      setUsers(data as UserOutDetailed[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load users';
      showAlert(message, 'error');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (userIds: string[]) => {
    try {
      setSaving(true);
      const { data } = await approveUsersBulk({
        body: { user_ids: userIds },
      });

      // Update local state
      setUsers((prevUsers) =>
        prevUsers.map((user) => {
          const updated = data?.success.find((u) => u.id === user.id);
          return updated || user;
        })
      );

      showAlert(`${data?.success.length || 0} user(s) approved successfully`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve users';
      showAlert(message, 'error');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (userIds: string[]) => {
    try {
      setSaving(true);
      const { data } = await revokeUsersBulk({
        body: { user_ids: userIds },
      });

      // Update local state
      setUsers((prevUsers) =>
        prevUsers.map((user) => {
          const updated = data?.success.find((u) => u.id === user.id);
          return updated || user;
        })
      );

      showAlert(`${data?.success.length || 0} user approval(s) revoked successfully`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to revoke user approvals';
      showAlert(message, 'error');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeny = async (userIds: string[]) => {
    try {
      setSaving(true);
      const { data } = await denyUsersBulk({
        body: { user_ids: userIds },
      });

      // Remove denied users from local state
      setUsers((prevUsers) =>
        prevUsers.filter((user) => !data?.success.some((u) => u.id === user.id))
      );

      showAlert(`${data?.success.length || 0} user(s) denied successfully`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to deny users';
      showAlert(message, 'error');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleGrantAdmin = async (userIds: string[]) => {
    try {
      setSaving(true);
      const { data } = await grantAdmin({
        body: { user_ids: userIds },
      });

      // Update local state
      setUsers((prevUsers) =>
        prevUsers.map((user) => {
          const updated = data?.success.find((u) => u.id === user.id);
          return updated || user;
        })
      );

      showAlert(`${data?.success.length || 0} user(s) granted admin successfully`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to grant admin';
      showAlert(message, 'error');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeAdmin = async (userIds: string[]) => {
    try {
      setSaving(true);
      const { data } = await revokeAdmin({
        body: { user_ids: userIds },
      });

      // Update local state
      setUsers((prevUsers) =>
        prevUsers.map((user) => {
          const updated = data?.success.find((u) => u.id === user.id);
          return updated || user;
        })
      );

      showAlert(`${data?.success.length || 0} admin role(s) revoked successfully`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to revoke admin';
      showAlert(message, 'error');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDisplayName = async () => {
    if (!currentUser || !displayNameInput.trim()) return;

    try {
      setSaving(true);
      const { data } = await editUserInfo({
        path: { user_id: currentUser.id },
        query: { new_display_name: displayNameInput.trim() },
      });

      if (data) {
        updateCurrentUser(data);
        setIsEditingDisplayName(false);
        showAlert('Display name updated successfully', 'success');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update display name';
      showAlert(message, 'error');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleStartEditDisplayName = () => {
    setDisplayNameInput(currentUser?.display_name || '');
    setIsEditingDisplayName(true);
  };

  const handleCancelEditDisplayName = () => {
    setIsEditingDisplayName(false);
    setDisplayNameInput('');
  };

  // Show loading state while user is being fetched
  if (userLoading || !currentUser) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading settings..." />
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-8">
          <div className="mb-3">
            <h1 className="text-3xl font-bold text-brand-800 mb-2">Settings</h1>
            <p className="text-sm text-gray-600">Manage your profile and platform settings</p>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-4 mb-3 border-b border-gray-200">
            <button
              onClick={() => setActiveTab('profile')}
              className={`px-4 py-3 border-b-2 transition-colors ${
                activeTab === 'profile'
                  ? 'border-brand-600 text-brand-800 font-medium'
                  : 'border-transparent text-gray-600 hover:text-brand-800'
              }`}
              type="button"
            >
              Profile
            </button>
            {currentUser.is_admin && (
              <button
                onClick={() => setActiveTab('users')}
                className={`px-4 py-3 border-b-2 transition-colors ${
                  activeTab === 'users'
                    ? 'border-brand-600 text-brand-800 font-medium'
                    : 'border-transparent text-gray-600 hover:text-brand-800'
                }`}
                type="button"
              >
                User Management
              </button>
            )}
          </div>

          {/* Tab Content */}
          {activeTab === 'profile' && (
            <div className="space-y-3">
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-brand-800 mb-4">Profile Information</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                    <input
                      type="text"
                      value={currentUser.email}
                      disabled
                      className="w-full border border-gray-300 rounded px-3 py-2 bg-gray-50 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Display Name
                    </label>
                    {isEditingDisplayName ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={displayNameInput}
                          onChange={(e) => setDisplayNameInput(e.target.value)}
                          disabled={saving}
                          className="flex-1 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 disabled:cursor-not-allowed"
                          placeholder="Enter display name"
                          autoFocus
                        />
                        <button
                          onClick={handleSaveDisplayName}
                          disabled={saving || !displayNameInput.trim()}
                          className="px-4 py-2 bg-brand-500 text-white rounded hover:bg-brand-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                        >
                          {saving && (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              />
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                              />
                            </svg>
                          )}
                          Save
                        </button>
                        <button
                          onClick={handleCancelEditDisplayName}
                          disabled={saving}
                          className="px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:cursor-not-allowed transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={currentUser.display_name || ''}
                          disabled
                          className="flex-1 border border-gray-300 rounded px-3 py-2 bg-gray-50 cursor-not-allowed"
                          placeholder="No display name set"
                        />
                        <button
                          onClick={handleStartEditDisplayName}
                          className="px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Account Status
                    </label>
                    <div className="flex gap-2">
                      <span
                        className={`inline-flex px-3 py-1.5 text-sm font-medium rounded-full ${
                          currentUser.is_approved
                            ? 'bg-neutral-100 text-neutral-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {currentUser.is_approved ? 'Approved' : 'Pending Approval'}
                      </span>
                      {currentUser.is_admin && (
                        <span className="inline-flex px-3 py-1.5 text-sm font-medium rounded-full bg-brand-300 text-brand-800">
                          Administrator
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'users' && currentUser.is_admin && (
            <div className="space-y-3">
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-brand-800">
                    Platform Users ({users.length})
                  </h2>
                  <button
                    onClick={loadUsers}
                    disabled={loading}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:bg-gray-50 disabled:cursor-not-allowed transition-colors text-gray-700 flex items-center gap-2"
                  >
                    {loading && (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    )}
                    Refresh
                  </button>
                </div>
                <PlatformUsersTable
                  users={users}
                  onApprove={handleApprove}
                  onRevoke={handleRevoke}
                  onDeny={handleDeny}
                  onGrantAdmin={handleGrantAdmin}
                  onRevokeAdmin={handleRevokeAdmin}
                  loading={loading}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Loading Overlay */}
      <LoadingOverlay visible={saving} text="Processing..." />
    </>
  );
};
