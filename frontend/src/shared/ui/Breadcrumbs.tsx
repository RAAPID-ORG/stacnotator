import { Link } from 'react-router-dom';

export interface BreadcrumbItem {
  label: string;
  path?: string; // If undefined, it's the current page (not clickable)
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

/**
 * Breadcrumb navigation component
 */
export const Breadcrumbs = ({ items }: BreadcrumbsProps) => {
  const allItems: BreadcrumbItem[] = [{ label: 'Home', path: '/' }, ...items];

  return (
    <header className="px-4 py-1.5 text-xs bg-white border-b border-neutral-200 flex-shrink-0">
      <nav className="flex items-center">
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
