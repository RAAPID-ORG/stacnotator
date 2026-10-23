import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccountStore } from '~/shared/stores/account.store';
import { Badge } from '~/shared/ui/Badge';

interface Member {
  user: { id: string; display_name: string; email?: string | null };
  is_admin: boolean;
}

interface MembersTableProps<M extends Member> {
  members: M[];
  /** Roles beyond admin/member, shown after that badge. */
  extraRoles?: (member: M) => ReactNode;
  /** Per-row actions; the column is left out without them. */
  actions?: (member: M) => ReactNode;
  emptyText: string;
  rowTestId?: string;
}

const headCls = 'px-4 py-3 text-[11px] font-medium text-neutral-600 uppercase tracking-wider';

/** The members of an organization or a project. Emails reach platform admins
 *  only; everyone else reads members by name. */
export function MembersTable<M extends Member>({
  members,
  extraRoles,
  actions,
  emptyText,
  rowTestId,
}: MembersTableProps<M>) {
  const { t } = useTranslation('members');
  const showEmails = useAccountStore((s) => s.account?.is_platform_admin ?? false);

  if (members.length === 0) {
    return <div className="text-center py-10 text-sm text-neutral-500">{emptyText}</div>;
  }
  return (
    <div className="overflow-x-auto border border-neutral-200 rounded-xl bg-white">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50/50 border-b border-neutral-200">
          <tr>
            <th className={`${headCls} text-left`}>{t('table.name')}</th>
            {showEmails && <th className={`${headCls} text-left`}>{t('table.email')}</th>}
            <th className={`${headCls} text-left`}>{t('table.role')}</th>
            {actions && <th className={`${headCls} text-right`}>{t('table.actions')}</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {members.map((member) => (
            <tr
              key={member.user.id}
              data-testid={rowTestId}
              className="hover:bg-neutral-50/60 transition-colors"
            >
              <td className="px-4 py-3 text-sm font-medium text-neutral-900">
                {member.user.display_name}
              </td>
              {showEmails && (
                <td className="px-4 py-3 text-xs text-neutral-500">{member.user.email}</td>
              )}
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  <Badge tone={member.is_admin ? 'brand' : 'neutral'}>
                    {member.is_admin ? t('table.admin') : t('table.member')}
                  </Badge>
                  {extraRoles?.(member)}
                </div>
              </td>
              {actions && (
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5 flex-wrap">{actions(member)}</div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const rowActionCls =
  'inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

const TONES = {
  neutral: 'text-neutral-700 hover:bg-neutral-100',
  accent: 'text-accent-700 hover:bg-accent-50',
  danger: 'text-red-600 hover:bg-red-50',
} as const;

/** One action in a member's row. */
export const RowAction = ({
  tone = 'neutral',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof TONES }) => (
  <button type="button" {...props} className={`${rowActionCls} ${TONES[tone]}`} />
);
