import type { AnnotationTaskOut, LabelBase } from '~/api/client';
import { capitalizeFirst } from '~/shared/utils/utility';
import { reviewRows, type ReviewRow } from '~/features/annotation/core/tasks';

export interface ReviewListProps {
  task: AnnotationTaskOut;
  currentUserId: string | null;
  labels: LabelBase[];
}

const cardFrame = 'text-[11px] rounded px-2.5 py-2 border';

const ConflictTriangleIcon = () => (
  <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor">
    <path d="M10 2 1 18h18L10 2Zm0 5.5 5.5 9.5h-11L10 7.5Zm-.75 3v3.5h1.5V10.5h-1.5Zm0 4.5V16h1.5v-1.5h-1.5Z" />
  </svg>
);

const FlagIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 17V3M4 3h10l-2 4 2 4H4" />
  </svg>
);

function resolveDisplayName(row: ReviewRow, currentUserId: string | null): string {
  if (row.userId === currentUserId) return 'You';
  if (row.kind === 'pending') {
    const a = row.assignment;
    return a.user_display_name || a.user_email || a.user_id.substring(0, 8);
  }
  const { annotation, assignment } = row;
  return (
    assignment?.user_display_name ||
    assignment?.user_email ||
    annotation.created_by_user_display_name ||
    annotation.created_by_user_email ||
    annotation.created_by_user_id.substring(0, 8)
  );
}

function PendingCard({
  row,
  currentUserId,
}: {
  row: Extract<ReviewRow, { kind: 'pending' }>;
  currentUserId: string | null;
}) {
  return (
    <div className={`${cardFrame} border-dashed border-neutral-300 bg-neutral-50`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-neutral-500">{resolveDisplayName(row, currentUserId)}</span>
        <span className="text-neutral-400 italic">Not labeled yet</span>
      </div>
    </div>
  );
}

function AnnotationCard({
  row,
  currentUserId,
  labels,
}: {
  row: Extract<ReviewRow, { kind: 'annotation' }>;
  currentUserId: string | null;
  labels: LabelBase[];
}) {
  const { annotation, isConflict, isExtra, isSkipped, isAuthoritative } = row;
  const isOwn = row.userId === currentUserId;

  const label = labels.find((l) => l.id === annotation.label_id);
  const labelName = label
    ? capitalizeFirst(label.name)
    : annotation.label_id
      ? `#${annotation.label_id}`
      : isSkipped
        ? 'Skipped'
        : '-';

  const bg = isAuthoritative
    ? 'bg-amber-50 border-amber-200'
    : isConflict
      ? 'bg-orange-50 border-orange-300'
      : isOwn
        ? 'bg-brand-50 border-brand-200'
        : 'bg-neutral-50 border-neutral-200';
  const nameColor = isConflict ? 'text-orange-700' : isOwn ? 'text-brand-700' : 'text-neutral-700';
  const labelColor = isSkipped
    ? 'text-neutral-500 italic'
    : isConflict
      ? 'text-orange-800'
      : 'text-neutral-800';

  return (
    <div className={`${cardFrame} ${bg} ${isExtra ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`font-bold ${nameColor}`}>
          {resolveDisplayName(row, currentUserId)}
          {isAuthoritative && (
            <span className="ml-1 text-amber-600" title="Authoritative">
              &#9975;
            </span>
          )}
          {annotation.flagged_for_review && (
            <span
              className="ml-1 inline-flex items-center align-middle text-rose-600"
              title={annotation.flag_comment || 'Flagged for review'}
            >
              <FlagIcon />
            </span>
          )}
          {isExtra && (
            <span
              className="ml-1.5 px-1 py-0.5 rounded bg-neutral-200 text-neutral-500 text-[9px] font-semibold uppercase tracking-wide align-middle"
              title="Does not count toward completion"
            >
              extra
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5 text-neutral-500">
          <span className={`font-medium ${labelColor}`}>{labelName}</span>
          {annotation.confidence != null && (
            <>
              <span className="text-neutral-300">|</span>
              <span title="Confidence">{annotation.confidence}/5</span>
            </>
          )}
        </div>
      </div>
      {annotation.comment?.trim() && (
        <div className="mt-1 text-neutral-600 italic whitespace-pre-wrap">
          &ldquo;{annotation.comment}&rdquo;
        </div>
      )}
      {annotation.flagged_for_review && annotation.flag_comment?.trim() && (
        <div className="mt-1 text-rose-700 italic whitespace-pre-wrap">
          Flag: &ldquo;{annotation.flag_comment}&rdquo;
        </div>
      )}
    </div>
  );
}

export function ReviewList({ task, currentUserId, labels }: ReviewListProps) {
  const hasContent = task.annotations.length > 0 || (task.assignments?.length ?? 0) > 0;
  if (!hasContent) return null;

  const rows = reviewRows(task.annotations, task.assignments ?? [], task.task_status);
  const isConflicting = task.task_status === 'conflicting';

  return (
    <div
      data-testid="review-list"
      className="flex flex-col gap-1.5 p-3 border-b border-neutral-100 w-full"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
          All Annotations
        </span>
        {isConflicting && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-semibold uppercase tracking-wide border border-orange-300">
            <ConflictTriangleIcon />
            Conflict
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((row) =>
          row.kind === 'pending' ? (
            <PendingCard key={`pending-${row.userId}`} row={row} currentUserId={currentUserId} />
          ) : (
            <AnnotationCard
              key={row.annotation.id}
              row={row}
              currentUserId={currentUserId}
              labels={labels}
            />
          )
        )}
      </div>
    </div>
  );
}
