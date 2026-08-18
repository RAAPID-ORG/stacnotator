import { useCallback, useEffect, useState } from 'react';
import {
  approveOrganizationAccessRequest,
  listOrganizationAccessRequests,
  rejectOrganizationAccessRequest,
  type AccessRequestOut,
} from '~/api/client';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';

export type AccessRequestsProps = {
  organizationId: number;
};

const actionClass =
  'inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

/** Registered users asking to join, for an org admin to decide on. Renders
 *  nothing while there are none, so a quiet org keeps a quiet page. */
export const AccessRequests = ({ organizationId }: AccessRequestsProps) => {
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);
  const [requests, setRequests] = useState<AccessRequestOut[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await listOrganizationAccessRequests({
        path: { organization_id: organizationId },
      });
      setRequests(data?.items ?? []);
    } catch (err) {
      handleError(err, 'Failed to load access requests');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (request: AccessRequestOut, approve: boolean) => {
    setBusyId(request.user.id);
    try {
      const path = { organization_id: organizationId, user_id: request.user.id };
      if (approve) await approveOrganizationAccessRequest({ path });
      else await rejectOrganizationAccessRequest({ path });
      await load();
    } catch (err) {
      handleError(err, approve ? 'Failed to approve request' : 'Failed to reject request');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (request: AccessRequestOut) => {
    const confirmed = await showConfirmDialog({
      title: `Reject ${request.user.display_name}?`,
      description: 'The request is dropped. They can ask again later.',
      confirmText: 'Reject',
      isDangerous: true,
    });
    if (confirmed) await decide(request, false);
  };

  if (requests.length === 0) return null;

  return (
    <section className="surface surface-section" data-testid="org-access-requests">
      <h2 className="section-heading">
        Access requests <span className="text-neutral-400 font-normal">({requests.length})</span>
      </h2>
      <p className="section-description">
        People who found this organization and asked to join. Approving makes them a member.
      </p>
      <ul className="mt-3 divide-y divide-neutral-100 border border-neutral-200 rounded-xl bg-white">
        {requests.map((request) => (
          <li key={request.user.id} data-testid="access-request-row" className="px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-neutral-900 truncate">{request.user.display_name}</p>
                {request.user.email && (
                  <p className="text-xs text-neutral-500">{request.user.email}</p>
                )}
                {request.note && (
                  <p className="mt-1.5 text-sm text-neutral-600 whitespace-pre-wrap">
                    {request.note}
                  </p>
                )}
              </div>
              <span className="text-[11px] text-neutral-500 shrink-0">
                {new Date(request.requested_at).toLocaleDateString()}
              </span>
              <div className="flex gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => decide(request, true)}
                  disabled={busyId === request.user.id}
                  className={`${actionClass} text-green-700 hover:bg-green-50`}
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => reject(request)}
                  disabled={busyId === request.user.id}
                  className={`${actionClass} text-red-600 hover:bg-red-50`}
                >
                  Reject
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};
