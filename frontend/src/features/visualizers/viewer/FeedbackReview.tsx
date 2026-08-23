import type { VisualizerFeedbackOut } from '~/api/client';
import { Badge } from '~/shared/ui/Badge';
import { Button, IconButton } from '~/shared/ui/forms';
import { IconChevronLeft, IconChevronRight, IconClose, IconTrash } from '~/shared/ui/Icons';
import { VERDICT } from './feedbackAreas';

/**
 * The pile of feedback as a table under the map, newest first.
 *
 * Picking a row is what moves the map: it frames that box and puts the imagery
 * back the way the person who left the remark had it, so the remark is read
 * over what it was about rather than over today's view.
 */
export function FeedbackReview({
  items,
  selectedId,
  onSelect,
  onStep,
  onDelete,
  onClose,
}: {
  items: VisualizerFeedbackOut[];
  selectedId: number | null;
  onSelect: (entry: VisualizerFeedbackOut) => void;
  onStep: (delta: number) => void;
  onDelete: (entry: VisualizerFeedbackOut) => void;
  onClose: () => void;
}) {
  const position = items.findIndex((entry) => entry.id === selectedId);

  return (
    <section
      className="flex max-h-[40vh] shrink-0 flex-col border-t border-neutral-200 bg-white"
      data-testid="visualizer-feedback-review"
    >
      <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
          Feedback
        </span>
        <span className="text-xs tabular-nums text-neutral-400">
          {items.length === 0 ? 'none yet' : `${Math.max(position, 0) + 1} / ${items.length}`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton onClick={() => onStep(-1)} aria-label="Newer feedback" title="Newer">
            <IconChevronLeft className="h-4 w-4" />
          </IconButton>
          <IconButton onClick={() => onStep(1)} aria-label="Older feedback" title="Older">
            <IconChevronRight className="h-4 w-4" />
          </IconButton>
          <IconButton onClick={onClose} aria-label="Close feedback review" title="Close">
            <IconClose className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-neutral-500">
          Nobody has left feedback on this map yet.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white text-[11px] uppercase tracking-wider text-neutral-400">
              <tr className="border-b border-neutral-100">
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Verdict</Th>
                <Th>Should be</Th>
                <Th>Note</Th>
                <Th>Viewing</Th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr
                  key={entry.id}
                  onClick={() => onSelect(entry)}
                  data-testid="visualizer-feedback-row"
                  data-selected={entry.id === selectedId}
                  className={`cursor-pointer border-b border-neutral-50 transition-colors ${
                    entry.id === selectedId ? 'bg-brand-50' : 'hover:bg-neutral-50'
                  }`}
                >
                  <Td className="whitespace-nowrap text-neutral-500">
                    {new Date(entry.created_at).toLocaleDateString()}
                  </Td>
                  <Td className="whitespace-nowrap font-medium text-neutral-900">{entry.author}</Td>
                  <Td>
                    {entry.verdict && VERDICT[entry.verdict] && (
                      <Badge tone={VERDICT[entry.verdict].tone}>
                        {VERDICT[entry.verdict].label}
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-neutral-900">
                    {entry.suggested_label && (
                      <>
                        {entry.suggested_label}
                        {entry.layer_name && (
                          <span className="text-neutral-400"> in {entry.layer_name}</span>
                        )}
                      </>
                    )}
                  </Td>
                  <Td className="max-w-xs truncate text-neutral-700" title={entry.note ?? ''}>
                    {entry.note}
                  </Td>
                  <Td className="whitespace-nowrap text-neutral-500">{entry.viewing}</Td>
                  <td className="px-2 py-2">
                    <Button
                      variant="dangerQuiet"
                      size="sm"
                      className="!h-6 !px-1.5"
                      title="Delete this feedback"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(entry);
                      }}
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const Th = ({ children }: { children?: React.ReactNode }) => (
  <th className="px-3 py-2 font-medium">{children}</th>
);

const Td = ({
  className,
  children,
  title,
}: {
  className?: string;
  children?: React.ReactNode;
  title?: string;
}) => (
  <td className={`px-3 py-2 ${className ?? ''}`} title={title}>
    {children}
  </td>
);
