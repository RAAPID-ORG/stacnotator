import { useState } from 'react';
import type { UserOutDetailed } from '~/api/client';

export type PlatformUsersTableProps = {
  users: UserOutDetailed[];
  onApprove: (userIds: string[]) => Promise<void>;
  onRevoke: (userIds: string[]) => Promise<void>;
  onDeny: (userIds: string[]) => Promise<void>;
  onGrantAdmin: (userIds: string[]) => Promise<void>;
  onRevokeAdmin: (userIds: string[]) => Promise<void>;
  loading?: boolean;
};

export const PlatformUsersTable = ({
  users,
  onApprove,
  onRevoke,
  onDeny,
  onGrantAdmin,
  onRevokeAdmin,
  loading = false,
}: PlatformUsersTableProps) => {
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [processingAction, setProcessingAction] = useState(false);

  const toggleUser = (userId: string) => {
    const newSelected = new Set(selectedUsers);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedUsers(newSelected);
  };

  const toggleAll = () => {
    if (selectedUsers.size === users.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(users.map((u) => u.id)));
    }
  };

  const handleBulkAction = async (
    action: 'approve' | 'revoke' | 'deny' | 'grant-admin' | 'revoke-admin'
  ) => {
    if (selectedUsers.size === 0) return;

    try {
      setProcessingAction(true);
      const userIds = Array.from(selectedUsers);

      switch (action) {
        case 'approve':
          await onApprove(userIds);
          break;
        case 'revoke':
          await onRevoke(userIds);
          break;
        case 'deny':
          await onDeny(userIds);
          break;
        case 'grant-admin':
          await onGrantAdmin(userIds);
          break;
        case 'revoke-admin':
          await onRevokeAdmin(userIds);
          break;
      }

      setSelectedUsers(new Set());
    } catch (err) {
      console.error('Bulk action failed', err);
    } finally {
      setProcessingAction(false);
    }
  };

  const handleSingleAction = async (
    userId: string,
    action: 'approve' | 'revoke' | 'deny' | 'grant-admin' | 'revoke-admin'
  ) => {
    try {
      setProcessingAction(true);

      switch (action) {
        case 'approve':
          await onApprove([userId]);
          break;
        case 'revoke':
          await onRevoke([userId]);
          break;
        case 'deny':
          await onDeny([userId]);
          break;
        case 'grant-admin':
          await onGrantAdmin([userId]);
          break;
        case 'revoke-admin':
          await onRevokeAdmin([userId]);
          break;
      }
    } catch (err) {
      console.error('Single action failed', err);
    } finally {
      setProcessingAction(false);
    }
  };

  const allSelected = selectedUsers.size === users.length && users.length > 0;
  const someSelected = selectedUsers.size > 0 && selectedUsers.size < users.length;

  return (
    <div className="space-y-4">
      {/* Bulk Actions */}
      {selectedUsers.size > 0 && (
        <div className="bg-brand-50 border border-brand-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-brand-800">
              {selectedUsers.size} user{selectedUsers.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => handleBulkAction('approve')}
                disabled={processingAction}
                className="px-3 py-1.5 text-sm bg-neutral-200 text-neutral-800 rounded hover:bg-neutral-400 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
              >
                Approve
              </button>
              <button
                onClick={() => handleBulkAction('revoke')}
                disabled={processingAction}
                className="px-3 py-1.5 text-sm bg-red-400 text-white rounded hover:bg-red-600 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
              >
                Revoke Approval
              </button>
              <button
                onClick={() => handleBulkAction('deny')}
                disabled={processingAction}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
              >
                Deny
              </button>
              <button
                onClick={() => handleBulkAction('grant-admin')}
                disabled={processingAction}
                className="px-3 py-1.5 text-sm bg-brand-400 text-white rounded hover:bg-brand-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
              >
                Make Admin
              </button>
              <button
                onClick={() => handleBulkAction('revoke-admin')}
                disabled={processingAction}
                className="px-3 py-1.5 text-sm bg-amber-400 text-white rounded hover:bg-amber-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
              >
                Revoke Admin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto border border-neutral-200 rounded-lg">
        <table className="w-full">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr>
              <th className="w-12 px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) {
                      el.indeterminate = someSelected;
                    }
                  }}
                  onChange={toggleAll}
                  disabled={loading || processingAction}
                  className="w-4 h-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-600 disabled:cursor-not-allowed"
                />
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-neutral-700">Email</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-neutral-700">
                Display Name
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-neutral-700">Status</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-neutral-700">Role</th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-neutral-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8">
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-brand-600"></div>
                    <span className="text-sm text-neutral-600">Loading users...</span>
                  </div>
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                  No users found
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} className="hover:bg-neutral-50 transition-colors">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedUsers.has(user.id)}
                      onChange={() => toggleUser(user.id)}
                      disabled={processingAction}
                      className="w-4 h-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-600 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-neutral-900">{user.email}</td>
                  <td className="px-4 py-3 text-sm text-neutral-700">{user.display_name || '-'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                        user.is_approved
                          ? 'bg-neutral-100 text-neutral-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {user.is_approved ? 'Approved' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                        user.is_admin
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-neutral-100 text-neutral-800'
                      }`}
                    >
                      {user.is_admin ? 'Admin' : 'User'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {!user.is_approved ? (
                        <>
                          <button
                            onClick={() => handleSingleAction(user.id, 'approve')}
                            disabled={processingAction}
                            className="px-2 py-1 text-xs bg-neutral-200 text-neutral-800 rounded hover:bg-neutral-400 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleSingleAction(user.id, 'deny')}
                            disabled={processingAction}
                            className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
                          >
                            Deny
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleSingleAction(user.id, 'revoke')}
                          disabled={processingAction}
                          className="px-2 py-1 text-xs bg-red-200 text-white rounded hover:bg-red-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
                        >
                          Revoke Approval
                        </button>
                      )}
                      {!user.is_admin ? (
                        <button
                          onClick={() => handleSingleAction(user.id, 'grant-admin')}
                          disabled={processingAction}
                          className="px-2 py-1 text-xs bg-brand-600 text-white rounded hover:bg-brand-800 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
                        >
                          Make Admin
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSingleAction(user.id, 'revoke-admin')}
                          disabled={processingAction}
                          className="px-2 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
                        >
                          Revoke Admin
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
