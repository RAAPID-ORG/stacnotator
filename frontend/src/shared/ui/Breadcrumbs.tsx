import { Link } from 'react-router-dom';

export interface BreadcrumbItem {
  label: string;
  path?: string; // If undefined, it's the current page (not clickable)
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  onMenuClick?: () => void;
}

/**
 * Breadcrumb navigation component
 */
export const Breadcrumbs = ({ items, onMenuClick }: BreadcrumbsProps) => {
  const allItems: BreadcrumbItem[] = [{ label: 'Home', path: '/' }, ...items];

  return (
    <header className="px-4 py-1.5 text-xs bg-white border-b border-neutral-200 flex-shrink-0 flex items-center gap-2">
      {onMenuClick && (
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open menu"
          className="desktop:hidden flex items-center justify-center w-7 h-7 -ml-1 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 5.5A.5.5 0 0 1 3.5 5h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1-.5-.5Zm0 4.5A.5.5 0 0 1 3.5 9.5h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1-.5-.5Zm.5 4a.5.5 0 0 0 0 1h13a.5.5 0 0 0 0-1h-13Z" />
          </svg>
        </button>
      )}
      <nav className="flex items-center min-w-0 flex-1 overflow-x-auto">
        {allItems.map((item, index) => {
          const isLast = index === allItems.length - 1;

          return (
            <span key={index} className="flex items-center">
              {item.path && !isLast ? (
                <Link
                  to={item.path}
                  className="text-neutral-500 hover:text-neutral-900 px-2 py-0.5 rounded transition-colors"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="font-medium text-neutral-900 px-2 py-0.5">{item.label}</span>
              )}
              {!isLast && <span className="text-neutral-300">/</span>}
            </span>
          );
        })}
      </nav>
    </header>
  );
};
