import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { newOrganizationPath, organizationPath } from '~/app/routes';
import { useOrgStore } from '~/shared/stores/org.store';
import { fieldClass } from '~/shared/ui/forms';
import { useOrganizations } from '../hooks/useOrganizations';
import { reconcileActiveOrgId } from '../utils/organizations';

export type OrgSwitcherProps = {
  onNavigate?: () => void;
};

const linkClass =
  'text-left text-xs text-neutral-600 hover:text-brand-700 transition-colors truncate w-full ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 rounded';

export const OrgSwitcher = ({ onNavigate }: OrgSwitcherProps) => {
  const navigate = useNavigate();
  const { orgs, loading } = useOrganizations();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const setActiveOrgId = useOrgStore((s) => s.setActiveOrgId);

  useEffect(() => {
    if (loading) return;
    const reconciled = reconcileActiveOrgId(orgs, activeOrgId);
    if (reconciled !== activeOrgId) setActiveOrgId(reconciled);
  }, [loading, orgs, activeOrgId, setActiveOrgId]);

  const activeOrg = orgs.find((o) => o.id === activeOrgId);

  const go = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  return (
    <div className="px-3 py-2.5 border-t border-neutral-200">
      <span className="block text-[10px] font-medium text-neutral-400 uppercase tracking-wider mb-1">
        Organization
      </span>
      {loading ? (
        <div className="h-8 rounded-md bg-neutral-100 animate-pulse" />
      ) : (
        <select
          data-testid="org-switcher"
          aria-label="Active organization"
          className={`${fieldClass('sm')} cursor-pointer`}
          value={activeOrgId === null ? '' : String(activeOrgId)}
          onChange={(e) => setActiveOrgId(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">No organization</option>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.status === 'pending' ? `${org.name} (pending)` : org.name}
            </option>
          ))}
        </select>
      )}
      <div className="flex flex-col items-start gap-0.5 mt-1.5">
        {activeOrg?.is_admin && (
          <button
            type="button"
            className={linkClass}
            onClick={() => go(organizationPath(activeOrg.id))}
          >
            Manage organization
          </button>
        )}
        <button type="button" className={linkClass} onClick={() => go(newOrganizationPath())}>
          New organization
        </button>
      </div>
    </div>
  );
};
