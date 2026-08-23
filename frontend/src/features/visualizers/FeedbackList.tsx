import { useEffect, useState } from 'react';
import {
  deleteVisualizerFeedback,
  listVisualizerFeedback,
  type VisualizerFeedbackOut,
} from '~/api/client';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Delayed } from '~/shared/ui/Delayed';
import { Button } from '~/shared/ui/forms';
import { IconComment, IconTrash } from '~/shared/ui/Icons';
import { Modal } from '~/shared/ui/Modal';
import { SkeletonRows } from '~/shared/ui/Skeleton';
import { listRowCls } from '~/shared/ui/listRow';
import { handleError } from '~/shared/utils/errorHandler';
import { visualizerPath } from './route';

/** What viewers have said about places on one published map. */
export function FeedbackList({
  visualizerId,
  visualizerName,
  slug,
  onClose,
  onChanged,
}: {
  visualizerId: number;
  visualizerName: string;
  slug: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<VisualizerFeedbackOut[] | null>(null);
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);

  useEffect(() => {
    let cancelled = false;
    listVisualizerFeedback({ path: { visualizer_id: visualizerId } })
      .then(({ data }) => !cancelled && setItems(data ?? []))
      .catch((error) => {
        handleError(error, 'Failed to load feedback');
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [visualizerId]);

  const remove = async (entry: VisualizerFeedbackOut) => {
    const confirmed = await showConfirmDialog({
      title: 'Delete this feedback?',
      description: 'It is removed for everyone, and the person who left it is not told.',
      confirmText: 'Delete',
      isDangerous: true,
    });
    if (!confirmed) return;
    try {
      await deleteVisualizerFeedback({
        path: { visualizer_id: visualizerId, feedback_id: entry.id },
      });
      setItems((current) => (current ?? []).filter((item) => item.id !== entry.id));
      onChanged();
    } catch (error) {
      handleError(error, 'Failed to delete the feedback');
    }
  };

  return (
    <Modal
      title={`Feedback on "${visualizerName}"`}
      onClose={onClose}
      maxWidth="max-w-2xl"
      scrollable
    >
      {items === null ? (
        <div className="p-4">
          <Delayed>
            <SkeletonRows count={3} />
          </Delayed>
        </div>
      ) : items.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <IconComment className="mx-auto h-6 w-6 text-neutral-300" />
          <p className="mt-2 text-sm text-neutral-600">Nobody has left feedback yet.</p>
          <p className="mt-1 text-xs text-neutral-500">
            Anyone signed in can leave some from the map itself.
          </p>
        </div>
      ) : (
        <div>
          {items.map((entry, index) => (
            <div
              key={entry.id}
              className={listRowCls(index, { extra: 'flex items-start gap-3 px-4 py-3' })}
              data-testid="visualizer-feedback-row"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-neutral-500">
                  <span className="font-medium text-neutral-900">{entry.author}</span>
                  <span>{new Date(entry.created_at).toLocaleDateString()}</span>
                  {entry.viewing && <span className="truncate">on {entry.viewing}</span>}
                </p>

                {entry.suggested_label && (
                  <p className="mt-1 text-sm text-neutral-900">
                    Should be <span className="font-medium">{entry.suggested_label}</span>
                    {entry.layer_name && (
                      <span className="text-neutral-500"> in {entry.layer_name}</span>
                    )}
                  </p>
                )}
                {entry.note && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">{entry.note}</p>
                )}

                <a
                  href={`${visualizerPath(slug)}#${areaHash(entry)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block font-mono text-[11px] text-neutral-400 hover:text-brand-700"
                  title="Open the map"
                >
                  {areaHash(entry)}
                </a>
              </div>

              <Button
                variant="dangerQuiet"
                size="sm"
                onClick={() => void remove(entry)}
                title="Delete this feedback"
                className="!h-7 !px-2"
              >
                <IconTrash className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

const areaHash = (entry: VisualizerFeedbackOut) =>
  [entry.area.west, entry.area.south, entry.area.east, entry.area.north]
    .map((value) => value.toFixed(4))
    .join(', ');
