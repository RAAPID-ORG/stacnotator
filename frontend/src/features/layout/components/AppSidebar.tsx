import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '~/app/providers/AuthProvider';
import { useAccountStore } from 'src/features/account/account.store';
import { handleError } from '~/shared/utils/errorHandler';

export const LogoutButton = () => {
  const navigate = useNavigate();
  const { auth } = useAuth();

  const handleLogout = async () => {
    try {
      await auth.logout();
      navigate('/');
    } catch (err) {
      handleError(err, 'Logout failed');
    }
  };

  return (
    <div
      onClick={handleLogout}
      className="cursor-pointer text-xs text-neutral-700 hover:text-red-500 select-none"
    >
      Logout
    </div>
  );
};

export type AppSidebarProps = {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
};

const deriveInitial = (displayName: string | null | undefined, email: string | undefined) => {
  const source = (displayName && displayName.trim()) || (email ?? '').split('@')[0] || '?';
  return source.trim().charAt(0).toUpperCase() || '?';
};

export const AppSidebar = ({ collapsed, setCollapsed }: AppSidebarProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const account = useAccountStore((s) => s.account);

  const currentPath = location.pathname;
  const isAnnotationPage = /^\/campaigns\/\d+\/annotate/.test(currentPath);

  const isHomeActive = currentPath === '/';
  const isCampaignsActive = currentPath.startsWith('/campaigns');
  const showToggle = isAnnotationPage;

  const handleNavClick = (path: string) => {
    navigate(path);
  };

  const itemBase =
    'flex items-center gap-3 py-1.5 text-left text-[13px] transition-colors w-full rounded-md cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30';
  const itemInactive = 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100';
  const itemActive = 'text-brand-800 bg-brand-50 font-medium';

  return (
    <aside
      className="flex flex-col h-full bg-white border-r border-neutral-200"
      style={{
        width: collapsed ? '60px' : '180px',
        transition: 'width 180ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <div className="flex items-center justify-between px-4 h-12 border-b border-neutral-200">
        {!collapsed && (
          <button
            onClick={() => handleNavClick('/')}
            className="text-sm font-semibold text-neutral-900 tracking-tight bg-none border-none p-0 cursor-pointer truncate focus:outline-none hover:text-brand-700 transition-colors"
            type="button"
          >
            STACNotator
          </button>
        )}

        {showToggle && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`p-1 text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer rounded focus:outline-none ${
              collapsed ? 'mx-auto' : ''
            }`}
            type="button"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
              <path d="M16.5 4C17.3284 4 18 4.67157 18 5.5V14.5C18 15.3284 17.3284 16 16.5 16H3.5C2.67157 16 2 15.3284 2 14.5V5.5C2 4.67157 2.67157 4 3.5 4H16.5ZM7 15H16.5C16.7761 15 17 14.7761 17 14.5V5.5C17 5.22386 16.7761 5 16.5 5H7V15ZM3.5 5C3.22386 5 3 5.22386 3 5.5V14.5C3 14.7761 3.22386 15 3.5 15H6V5H3.5Z" />
            </svg>
          </button>
        )}
      </div>

      <nav className="flex flex-col flex-1 py-3 px-2 gap-0.5">
        <button
          onClick={() => handleNavClick('/')}
          className={`${itemBase} ${collapsed ? 'justify-center' : 'px-2.5'} ${
            isHomeActive ? itemActive : itemInactive
          }`}
          title="Home"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" className="shrink-0">
            <path d="M10.7071 2.29289C10.3166 1.90237 9.68342 1.90237 9.29289 2.29289L2.29289 9.29289C1.90237 9.68342 1.90237 10.3166 2.29289 10.7071C2.68342 11.0976 3.31658 11.0976 3.70711 10.7071L4 10.4142V16.5C4 17.3284 4.67157 18 5.5 18H8.5C9.05228 18 9.5 17.5523 9.5 17V13.5C9.5 13.2239 9.72386 13 10 13C10.2761 13 10.5 13.2239 10.5 13.5V17C10.5 17.5523 10.9477 18 11.5 18H14.5C15.3284 18 16 17.3284 16 16.5V10.4142L16.2929 10.7071C16.6834 11.0976 17.3166 11.0976 17.7071 10.7071C18.0976 10.3166 18.0976 9.68342 17.7071 9.29289L10.7071 2.29289ZM15 9.41421V16.5C15 16.7761 14.7761 17 14.5 17H11.5V13.5C11.5 12.6716 10.8284 12 10 12C9.17157 12 8.5 12.6716 8.5 13.5V17H5.5C5.22386 17 5 16.7761 5 16.5V9.41421L10 4.41421L15 9.41421Z" />
          </svg>
          {!collapsed && <span className="truncate">Home</span>}
        </button>

        <button
          onClick={() => handleNavClick('/campaigns')}
          className={`${itemBase} ${collapsed ? 'justify-center' : 'px-2.5'} ${
            isCampaignsActive ? itemActive : itemInactive
          }`}
          title="Campaigns"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" className="shrink-0">
            <path d="M2 5.5C2 4.67157 2.67157 4 3.5 4H7.08579C7.351 4 7.60536 4.10536 7.79289 4.29289L9.20711 5.70711C9.39464 5.89464 9.649 6 9.91421 6H16.5C17.3284 6 18 6.67157 18 7.5V14.5C18 15.3284 17.3284 16 16.5 16H3.5C2.67157 16 2 15.3284 2 14.5V5.5ZM3.5 5C3.22386 5 3 5.22386 3 5.5V14.5C3 14.7761 3.22386 15 3.5 15H16.5C16.7761 15 17 14.7761 17 14.5V7.5C17 7.22386 16.7761 7 16.5 7H9.91421C9.649 7 9.39464 6.89464 9.20711 6.70711L7.79289 5.29289C7.60536 5.10536 7.351 5 7.08579 5H3.5Z" />
          </svg>
          {!collapsed && <span className="truncate">Campaigns</span>}
        </button>
      </nav>

      <div className="p-3 border-t border-neutral-200 mt-auto">
        <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
          <button
            onClick={() => handleNavClick('/settings')}
            type="button"
            title={account?.display_name || account?.email || 'Open settings'}
            aria-label="Open settings"
            className="w-7 h-7 rounded-full bg-brand-50 border border-brand-200 text-brand-800 flex items-center justify-center text-[11px] font-semibold shrink-0 hover:bg-brand-100 hover:border-brand-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30"
          >
            {deriveInitial(account?.display_name, account?.email)}
          </button>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <button
                onClick={() => handleNavClick('/settings')}
                type="button"
                className="block text-[13px] text-neutral-700 hover:text-brand-700 cursor-pointer transition-colors truncate text-left w-full"
              >
                {account?.display_name || account?.email || 'Settings'}
              </button>
              <LogoutButton />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
