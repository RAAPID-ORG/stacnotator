import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { newOrganizationPath, organizationPath } from '~/app/routes';
import { useOrgStore } from '~/shared/stores/org.store';
import { Badge } from '~/shared/ui/Badge';
import { IconBuilding, IconCheck, IconChevronDown, IconGear, IconPlus } from '~/shared/ui/Icons';
import { useOrganizations } from '../hooks/useOrganizations';
import { reconcileActiveOrgId } from '../utils/organizations';

export type OrgSwitcherProps = {
  onNavigate?: () => void;
};

const menuItemClass =
  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-neutral-700 rounded-md ' +
  'transition-colors hover:bg-neutral-100 focus:outline-none focus-visible:bg-neutral-100';

export const OrgSwitcher = ({ onNavigate }: OrgSwitcherProps) => {
  const navigate = useNavigate();
  const { orgs, loading } = useOrganizations();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const hasChosenOrg = useOrgStore((s) => s.hasChosenOrg);
  const setActiveOrgId = useOrgStore((s) => s.setActiveOrgId);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading) return;
    const reconciled = reconcileActiveOrgId(orgs, activeOrgId, hasChosenOrg);
    if (reconciled !== activeOrgId) setActiveOrgId(reconciled);
  }, [loading, orgs, activeOrgId, hasChosenOrg, setActiveOrgId]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && !containerRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const menuItems = useCallback(
    () =>
      Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []),
    []
  );

  useEffect(() => {
    if (!open) return;
    const items = menuItems();
    const active = items.find((item) => item.getAttribute('aria-checked') === 'true');
    (active ?? items[0])?.focus();
  }, [open, menuItems]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Tab') {
      // Refocus the trigger without cancelling the default, so Tab and
      // Shift-Tab leave the closed menu in natural document order.
      close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = menuItems();
    if (items.length === 0) return;
    const current = items.findIndex((item) => item === document.activeElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    items[(current + step + items.length) % items.length]?.focus();
  };

  const activeOrg = orgs.find((o) => o.id === activeOrgId);

  const selectOrg = (id: number | null) => {
    setActiveOrgId(id);
    close();
  };

  const go = (path: string) => {
    close();
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
        <div className="relative" ref={containerRef}>
          <button
            ref={triggerRef}
            type="button"
            data-testid="org-switcher"
            aria-label="Active organization"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && !open) {
                e.preventDefault();
                setOpen(true);
              }
            }}
            className="flex w-full items-center gap-2 h-8 px-2 text-xs text-neutral-700 bg-white border border-neutral-300 rounded-md shadow-sm cursor-pointer transition-colors hover:bg-neutral-50 focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15"
          >
            <IconBuilding className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            <span className="flex-1 min-w-0 truncate text-left font-medium">
              {activeOrg?.name ?? 'No organization'}
            </span>
            {activeOrg?.status === 'pending' && <Badge tone="yellow">Pending</Badge>}
            <IconChevronDown
              className={`w-3.5 h-3.5 text-neutral-400 shrink-0 transition-transform ${
                open ? 'rotate-180' : ''
              }`}
            />
          </button>

          {open && (
            <div
              ref={menuRef}
              role="menu"
              aria-label="Switch organization"
              onKeyDown={handleMenuKeyDown}
              className="absolute bottom-full left-0 mb-1 w-56 p-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-50"
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={activeOrgId === null}
                onClick={() => selectOrg(null)}
                className={menuItemClass}
              >
                <span className="w-3.5 shrink-0">
                  {activeOrgId === null && <IconCheck className="w-3.5 h-3.5 text-brand-600" />}
                </span>
                <span className="flex-1 min-w-0 truncate text-neutral-500">No organization</span>
              </button>
              {orgs.map((org) => (
                <button
                  key={org.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={org.id === activeOrgId}
                  onClick={() => selectOrg(org.id)}
                  className={menuItemClass}
                >
                  <span className="w-3.5 shrink-0">
                    {org.id === activeOrgId && <IconCheck className="w-3.5 h-3.5 text-brand-600" />}
                  </span>
                  <span
                    className={`flex-1 min-w-0 truncate ${
                      org.id === activeOrgId ? 'font-medium text-neutral-900' : ''
                    }`}
                    title={org.name}
                  >
                    {org.name}
                  </span>
                  {org.status === 'pending' && <Badge tone="yellow">Pending</Badge>}
                </button>
              ))}

              <div role="separator" className="my-1 border-t border-neutral-100" />

              {activeOrg?.is_admin && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => go(organizationPath(activeOrg.id))}
                  className={menuItemClass}
                >
                  <IconGear className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  Manage organization
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => go(newOrganizationPath())}
                className={menuItemClass}
              >
                <IconPlus className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                New organization
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
