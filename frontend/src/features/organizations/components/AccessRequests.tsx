import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AccessRequestOut } from '~/api/client';
import {
  approveOrganizationAccessRequestMutation,
  listOrganizationAccessRequestsOptions,
  listOrganizationAccessRequestsQueryKey,
  rejectOrganizationAccessRequestMutation,
} from '~/api/queries';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useRefreshOrganizations } from '../hooks/useOrganizations';

export type AccessRequestsProps = {
  organizationId: number;
};

const NONE: AccessRequestOut[] = [];

const actionClass =
  'inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

/** Registered users asking to join, for an org admin to decide on. Renders
 *  nothing while there are none, so a quiet org keeps a quiet page. */
export const AccessRequests = ({ organizationId }: AccessRequestsProps) => {
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);
  const queryClient = useQueryClient();
  const refreshOrganizations = useRefreshOrganizations();
  const path = { organization_id: organizationId };

  const { data } = useQuery({
    ...listOrganizationAccessRequestsOptions({ path }),
    meta: { errorMessage: 'Failed to load access requests' },
  });
  const requests = data?.items ?? NONE;

  const afterDecision = () => {
    void queryClient.invalidateQueries({
      queryKey: listOrganizationAccessRequestsQueryKey({ path }),
    });
    // The organization list carries the pending count the sidebar badges.
    void refreshOrganizations();
  };

  const approve = useMutation({
    ...approveOrganizationAccessRequestMutation(),
    meta: { errorMessage: 'Failed to approve request' },
    onSuccess: afterDecision,
  });
  const deny = useMutation({
    ...rejectOrganizationAccessRequestMutation(),
    meta: { errorMessage: 'Failed to reject request' },
    onSuccess: afterDecision,
  });

  // Only one decision can be in flight, so the pending mutation's own
  // variables say which row to disable.
  const deciding = approve.isPending ? approve.variables : deny.isPending ? deny.variables : null;
  const busyId = deciding?.path.user_id ?? null;

  const decide = (request: AccessRequestOut, shouldApprove: boolean) => {
    const vars = { path: { ...path, user_id: request.user.id } };
    if (shouldApprove) approve.mutate(vars);
    else deny.mutate(vars);
  };

  const reject = async (request: AccessRequestOut) => {
    const confirmed = await showConfirmDialog({
      title: `Reject ${request.user.display_name}?`,
      description: 'The request is dropped. They can ask again later.',
      confirmText: 'Reject',
      isDangerous: true,
    });
    if (confirmed) decide(request, false);
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
