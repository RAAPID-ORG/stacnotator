import type { AnnotationTaskOut, LabelBase } from '~/api/client';
import { capitalizeFirst } from '~/shared/utils/utility';

interface ReviewAnnotationListProps {
  currentTask: AnnotationTaskOut;
  currentUserId: string | null;
  labels: LabelBase[];
}

type Entry =
  | { kind: 'annotation'; annotation: AnnotationTaskOut['annotations'][number] }
  | { kind: 'pending'; assignment: NonNullable<AnnotationTaskOut['assignments']>[number] };

const buildEntries = (task: AnnotationTaskOut, currentUserId: string | null): Entry[] => {
  const annByUser = new Map(task.annotations.map((a) => [a.created_by_user_id, a]));
  const entries: Entry[] = [];
  const seenUserIds = new Set<string>();

  for (const assn of task.assignments ?? []) {
    seenUserIds.add(assn.user_id);
    const ann = annByUser.get(assn.user_id);
    entries.push(
      ann ? { kind: 'annotation', annotation: ann } : { kind: 'pending', assignment: assn }
    );
  }
  for (const ann of task.annotations) {
    if (!seenUserIds.has(ann.created_by_user_id)) {
      entries.push({ kind: 'annotation', annotation: ann });
    }
  }

  entries.sort((a, b) => {
    const aOwn =
      a.kind === 'annotation'
        ? a.annotation.created_by_user_id === currentUserId
        : a.assignment.user_id === currentUserId;
    const bOwn =
      b.kind === 'annotation'
        ? b.annotation.created_by_user_id === currentUserId
        : b.assignment.user_id === currentUserId;
    if (aOwn && !bOwn) return 1;
    if (!aOwn && bOwn) return -1;
    return 0;
  });

  return entries;
};

export const ReviewAnnotationList = ({
  currentTask,
  currentUserId,
  labels,
}: ReviewAnnotationListProps) => {
  const hasContent =
    (currentTask.annotations?.length ?? 0) > 0 || (currentTask.assignments?.length ?? 0) > 0;

  if (!hasContent) return null;

  const entries = buildEntries(currentTask, currentUserId);

  return (
    <div className="flex flex-col gap-1.5 p-3 border-b border-neutral-100 w-full">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
          All Annotations
        </span>
        {currentTask.task_status === 'conflicting' && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-semibold uppercase tracking-wide border border-orange-300">
            <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 2 1 18h18L10 2Zm0 5.5 5.5 9.5h-11L10 7.5Zm-.75 3v3.5h1.5V10.5h-1.5Zm0 4.5V16h1.5v-1.5h-1.5Z" />
            </svg>
            Conflict
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {entries.map((entry) => {
          if (entry.kind === 'pending') {
            const assn = entry.assignment;
            const isOwn = assn.user_id === currentUserId;
            const displayName = isOwn
              ? 'You'
              : assn.user_display_name || assn.user_email || assn.user_id.substring(0, 8);
            return (
              <div
                key={`pending-${assn.user_id}`}
                className="text-[11px] rounded px-2.5 py-2 border border-dashed border-neutral-300 bg-neutral-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-neutral-500">{displayName}</span>
                  <span className="text-neutral-400 italic">Not labeled yet</span>
                </div>
              </div>
            );
          }

          const ann = entry.annotation;
          const isOwn = ann.created_by_user_id === currentUserId;
          const assignment = currentTask.assignments?.find(
            (a) => a.user_id === ann.created_by_user_id
          );
          const isSkipped = assignment?.status === 'skipped';
          const displayName = isOwn
            ? 'You'
            : assignment?.user_display_name ||
              assignment?.user_email ||
              ann.created_by_user_display_name ||
              ann.created_by_user_email ||
              ann.created_by_user_id.substring(0, 8);
          const label = labels.find((l) => l.id === ann.label_id);
          const labelName = label
            ? capitalizeFirst(label.name)
            : ann.label_id
              ? `#${ann.label_id}`
              : isSkipped
                ? 'Skipped'
                : '-';

          // Authoritative amber beats conflict orange.
          const isConflict = currentTask.task_status === 'conflicting' && !ann.is_authoritative;
          const cardClass = ann.is_authoritative
            ? 'bg-amber-50 border-amber-200'
            : isConflict
              ? 'bg-orange-50 border-orange-300'
              : isOwn
                ? 'bg-brand-50 border-brand-200'
                : 'bg-neutral-50 border-neutral-200';

          return (
            <div key={ann.id} className={`text-[11px] rounded px-2.5 py-2 border ${cardClass}`}>
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`font-bold ${
                    isConflict ? 'text-orange-700' : isOwn ? 'text-brand-700' : 'text-neutral-700'
                  }`}
                >
                  {displayName}
                  {ann.is_authoritative && (
                    <span className="ml-1 text-amber-600" title="Authoritative">
                      🗲
                    </span>
                  )}
                  {ann.flagged_for_review && (
                    <span
                      className="ml-1 inline-flex items-center align-middle text-rose-600"
                      title={ann.flag_comment || 'Flagged for review'}
                    >
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
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1.5 text-neutral-500">
                  <span
                    className={`font-medium ${
                      isSkipped
                        ? 'text-neutral-500 italic'
                        : isConflict
                          ? 'text-orange-800'
                          : 'text-neutral-800'
                    }`}
                  >
                    {labelName}
                  </span>
                  {ann.confidence !== null && ann.confidence !== undefined && (
                    <>
                      <span className="text-neutral-300">|</span>
                      <span title="Confidence">{ann.confidence}/5</span>
                    </>
                  )}
                </div>
              </div>
              {ann.comment && ann.comment.trim() !== '' && (
                <div className="mt-1 text-neutral-600 italic whitespace-pre-wrap">
                  &ldquo;{ann.comment}&rdquo;
                </div>
              )}
              {ann.flagged_for_review && ann.flag_comment && ann.flag_comment.trim() !== '' && (
                <div className="mt-1 text-rose-700 italic whitespace-pre-wrap">
                  Flag: &ldquo;{ann.flag_comment}&rdquo;
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
