import type { ReactNode } from 'react';

/** {ulsing placeholder block. Size/shape it with utility classes (h-, w-, rounded-) **/
export const Skeleton = ({ className = '' }: { className?: string }) => (
  <div
    className={`animate-pulse rounded-md bg-neutral-200/80 motion-reduce:animate-none ${className}`}
  />
);

/** Standard page skeleton shared by the content pages **/
export const SkeletonPage = ({
  children,
  action = true,
}: {
  children: ReactNode;
  action?: boolean;
}) => (
  <div className="flex-1 overflow-auto" role="status" aria-label="Loading">
    <div className="page">
      <header className="page-header">
        <div className="space-y-2.5">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        {action && <Skeleton className="h-9 w-32 shrink-0" />}
      </header>
      {children}
    </div>
    <span className="sr-only">Loading</span>
  </div>
);

/** A `surface` of divided list rows (icon + two text lines + trailing pill),
 *  mirroring the campaigns list and review tables. */
export const SkeletonRows = ({ count = 6 }: { count?: number }) => (
  <div className="surface">
    <ul className="divide-y divide-neutral-100">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="h-9 w-9 rounded-xl shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full shrink-0" />
        </li>
      ))}
    </ul>
  </div>
);

/** A responsive grid of card placeholders, mirroring the task-set cards. */
export const SkeletonCards = ({ count = 3 }: { count?: number }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="surface">
        <div className="surface-section space-y-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-1.5 w-full rounded-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
    ))}
  </div>
);

/** Stacked labelled-field placeholders inside a `surface`, mirroring the
 *  settings/tasks forms. */
export const SkeletonForm = ({ sections = 3 }: { sections?: number }) => (
  <div className="surface">
    <div className="surface-section space-y-6">
      {Array.from({ length: sections }).map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      ))}
    </div>
  </div>
);
