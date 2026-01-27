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
  const allItems: BreadcrumbItem[] = [
    { label: 'Home', path: '/' },
    ...items,
  ];

  return (
    <header className="px-4 py-1 text-sm font-normal bg-neutral-100 border-b border-neutral-300 flex-shrink-0">
      <nav className="flex items-center">
        {allItems.map((item, index) => {
          const isLast = index === allItems.length - 1;
          
          return (
            <span key={index} className="flex items-center">
              {item.path && !isLast ? (
                <Link
                  to={item.path}
                  className="text-neutral-700 hover:text-brand-700 px-2 py-0.5 rounded transition-colors pointer-cursor"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="font-semibold text-brand-700 px-2 py-0.5">
                  {item.label}
                </span>
              )}
              
              {!isLast && (
                <span className="text-neutral-700"> / </span>
              )}
            </span>
          );
        })}
      </nav>
    </header>
  );
};
