import { useState } from 'react';
import type { UserOutDetailed } from '~/api/client';
import { Button } from '~/shared/ui/forms';
import { handleError } from '~/shared/utils/errorHandler';

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
      handleError(err, 'Bulk action failed', { showUser: false });
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
      handleError(err, 'Single action failed', { showUser: false });
    } finally {
      setProcessingAction(false);
    }
  };

  const allSelected = selectedUsers.size === users.length && users.length > 0;
  const someSelected = selectedUsers.size > 0 && selectedUsers.size < users.length;

  // Compact inline action button. Consistent height + radius with everything
  // else, just scaled down for a dense table row.
  const rowActionCls =
    'inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="space-y-4">
      {/* Bulk actions strip */}
      {selectedUsers.size > 0 && (
        <div className="bg-brand-50 border border-brand-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-brand-800">
            {selectedUsers.size} user{selectedUsers.size > 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => handleBulkAction('approve')}
              disabled={processingAction}
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleBulkAction('revoke')}
              disabled={processingAction}
            >
              Revoke approval
            </Button>
            <Button
              variant="danger"
              onClick={() => handleBulkAction('deny')}
              disabled={processingAction}
            >
              Deny
            </Button>
            <Button onClick={() => handleBulkAction('grant-admin')} disabled={processingAction}>
              Make admin
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleBulkAction('revoke-admin')}
              disabled={processingAction}
            >
              Revoke admin
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto border border-neutral-200 rounded-xl shadow-sm bg-white">
        <table className="w-full">
          <thead className="bg-neutral-50/50 border-b border-neutral-200">
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
              <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
                Email
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
                Display name
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
                Status
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
                <td colSpan={6} className="px-4 py-10">
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-200 border-t-brand-600" />
                    <span className="text-xs text-neutral-500">Loading users…</span>
                  </div>
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-neutral-500">
                  No users found
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} className="hover:bg-neutral-50/60 transition-colors">
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
                  <td className="px-4 py-3 text-sm text-neutral-600">{user.display_name || '-'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full border ${
                        user.is_approved
                          ? 'bg-brand-50 text-brand-800 border-brand-200'
                          : 'bg-yellow-50 text-yellow-800 border-yellow-200'
                      }`}
                    >
                      {user.is_approved ? 'Approved' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full border ${
                        user.is_admin
                          ? 'bg-accent-50 text-accent-800 border-accent-200'
                          : 'bg-neutral-50 text-neutral-700 border-neutral-200'
                      }`}
                    >
                      {user.is_admin ? 'Admin' : 'User'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      {!user.is_approved ? (
                        <>
                          <button
                            onClick={() => handleSingleAction(user.id, 'approve')}
                            disabled={processingAction}
                            className={`${rowActionCls} bg-white text-neutral-700 border border-neutral-300 hover:bg-neutral-50`}
                            type="button"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleSingleAction(user.id, 'deny')}
                            disabled={processingAction}
                            className={`${rowActionCls} text-red-600 hover:bg-red-50`}
                            type="button"
                          >
                            Deny
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleSingleAction(user.id, 'revoke')}
                          disabled={processingAction}
                          className={`${rowActionCls} text-red-600 hover:bg-red-50`}
                          type="button"
                        >
                          Revoke approval
                        </button>
                      )}
                      {!user.is_admin ? (
                        <button
                          onClick={() => handleSingleAction(user.id, 'grant-admin')}
                          disabled={processingAction}
                          className={`${rowActionCls} text-brand-700 hover:bg-brand-50`}
                          type="button"
                        >
                          Make admin
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSingleAction(user.id, 'revoke-admin')}
                          disabled={processingAction}
                          className={`${rowActionCls} text-amber-700 hover:bg-amber-50`}
                          type="button"
                        >
                          Revoke admin
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
