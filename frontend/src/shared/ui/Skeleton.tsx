/**
 * Placeholder block. Size/shape it with utility classes (h-, w-, rounded-).
 *
 * It reserves its space on mount but only fades in if the wait lasts long
 * enough to notice (see `.motion-skeleton`), so a fast load swaps straight to
 * content with neither a flash nor a jump. Callers do not need to delay it.
 */
export const Skeleton = ({ className = '' }: { className?: string }) => (
  <div className={`motion-skeleton rounded-md bg-neutral-200/80 ${className}`} />
);

/** A `surface` of divided list rows (icon + two text lines + trailing pill),
 *  mirroring the campaigns list and review tables. */
export const SkeletonRows = ({ count = 6 }: { count?: number }) => (
  <div className="surface" role="status" aria-label="Loading">
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
  <div
    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
    role="status"
    aria-label="Loading"
  >
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
  <div className="surface" role="status" aria-label="Loading">
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
