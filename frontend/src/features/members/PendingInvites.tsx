import { Trans, useTranslation } from 'react-i18next';
import i18n from '~/shared/i18n';
import type { InviteOut } from '~/api/client';

/** Shown next to both add-by-email flows and on invited results. */
export const inviteSignupNote = () => i18n.t('members:invites.signupNote');

interface PendingInvitesProps {
  invites: InviteOut[];
  onRevoke: (invite: InviteOut) => void;
  /** The invite currently being revoked, so only its own button goes quiet. */
  revokingId: number | null;
  className?: string;
}

/** The unconsumed email pre-authorizations for one organization or project:
 *  addresses that were added before signing up. Renders nothing while empty.
 *  The owner supplies the list, since only it knows which API holds them. */
export const PendingInvites = ({
  invites,
  onRevoke,
  revokingId,
  className,
}: PendingInvitesProps) => {
  const { t } = useTranslation('members');
  if (invites.length === 0) return null;

  return (
    <div className={className}>
      <h3 className="text-sm font-medium text-neutral-900">
        <Trans
          t={t}
          i18nKey="invites.pendingHeading"
          values={{ count: invites.length }}
          components={{ count: <span className="text-neutral-400 font-normal" /> }}
        />
      </h3>
      <p className="text-xs text-neutral-500 mt-0.5">{t('invites.pendingDescription')}</p>
      <ul className="mt-2 divide-y divide-neutral-100 border border-neutral-200 rounded-xl bg-white">
        {invites.map((invite) => (
          <li
            key={invite.id}
            data-testid="pending-invite-row"
            className="flex items-center gap-3 px-4 py-2.5"
          >
            <span className="flex-1 min-w-0 text-sm text-neutral-900 truncate">{invite.email}</span>
            <span className="text-[11px] text-neutral-500 shrink-0">
              {t('invites.invitedOn', { date: new Date(invite.created_at).toLocaleDateString() })}
            </span>
            <button
              type="button"
              onClick={() => onRevoke(invite)}
              disabled={revokingId === invite.id}
              className="inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('invites.revoke')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
