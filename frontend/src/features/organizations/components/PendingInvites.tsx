import { useCallback, useEffect, useState } from 'react';
import type { InviteOut } from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';

/** Shown next to both add-by-email flows and on invited results. */
export const INVITE_SIGNUP_NOTE =
  'They need to sign up at stacnotator.io with this email address; they will join automatically after signing up.';

interface PendingInvitesProps {
  listInvites: () => Promise<InviteOut[]>;
  revokeInvite: (inviteId: number) => Promise<void>;
  /** Bump after an add-by-email round so freshly created invites appear. */
  reloadKey: number;
  className?: string;
}

/** The unconsumed email pre-authorizations for one organization or project:
 *  addresses that were added before signing up. Renders nothing while empty. */
export const PendingInvites = ({
  listInvites,
  revokeInvite,
  reloadKey,
  className,
}: PendingInvitesProps) => {
  const [invites, setInvites] = useState<InviteOut[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setInvites(await listInvites());
    } catch (err) {
      handleError(err, 'Failed to load pending signups');
    }
  }, [listInvites]);

  useEffect(() => {
    void load();
    // reloadKey is the parent's signal that the invite set may have changed.
  }, [load, reloadKey]);

  const handleRevoke = async (invite: InviteOut) => {
    setBusyId(invite.id);
    try {
      await revokeInvite(invite.id);
      await load();
    } catch (err) {
      handleError(err, 'Failed to revoke invite');
    } finally {
      setBusyId(null);
    }
  };

  if (invites.length === 0) return null;

  return (
    <div className={className}>
      <h3 className="text-sm font-medium text-neutral-900">
        Pending signups <span className="text-neutral-400 font-normal">({invites.length})</span>
      </h3>
      <p className="text-xs text-neutral-500 mt-0.5">
        These addresses join automatically once they sign up. Revoking removes the
        pre-authorization.
      </p>
      <ul className="mt-2 divide-y divide-neutral-100 border border-neutral-200 rounded-xl bg-white">
        {invites.map((invite) => (
          <li
            key={invite.id}
            data-testid="pending-invite-row"
            className="flex items-center gap-3 px-4 py-2.5"
          >
            <span className="flex-1 min-w-0 text-sm text-neutral-900 truncate">{invite.email}</span>
            <span className="text-[11px] text-neutral-500 shrink-0">
              invited {new Date(invite.created_at).toLocaleDateString()}
            </span>
            <button
              type="button"
              onClick={() => handleRevoke(invite)}
              disabled={busyId === invite.id}
              className="inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
