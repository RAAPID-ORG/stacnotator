import { useWorkStore } from '~/features/annotation/stores';
import type { ComposeCtx } from '../registry';
import { clearEditSession, useEditSession } from '../shared/editSession';
import { commitEdit, deleteSelection, useDrawingInteractions } from './useDrawingInteractions';

export interface EditOverlayControlsProps {
  ctx: ComposeCtx;
}

const buttonClass =
  'px-2.5 py-1 rounded text-[11px] font-semibold text-white shadow disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors';

export function EditOverlayControls({ ctx }: EditOverlayControlsProps) {
  useDrawingInteractions(ctx);

  const selection = useWorkStore((s) => s.selection);
  const pending = useEditSession((s) => s.pending);
  const busy = useEditSession((s) => s.busy);

  if (ctx.mode !== 'explore' || selection.length === 0) return null;

  return (
    <div
      data-testid="edit-controls"
      data-selected-count={selection.length}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 rounded-full bg-neutral-800/95 px-3 py-1.5 text-white shadow-lg"
    >
      <span className="text-[11px] font-semibold tabular-nums">
        {selection.length === 1 ? 'Annotation selected' : `${selection.length} selected`}
      </span>
      {pending && (
        <button
          type="button"
          data-testid="edit-confirm-btn"
          disabled={busy}
          onClick={() => void commitEdit(ctx.campaign.id)}
          title="Confirm edits (Enter)"
          className={`${buttonClass} bg-green-600 hover:bg-green-700`}
        >
          Save shape
        </button>
      )}
      <button
        type="button"
        data-testid="edit-delete-btn"
        disabled={busy}
        onClick={() => void deleteSelection(ctx.campaign.id)}
        title={
          selection.length > 1
            ? `Delete ${selection.length} annotations (Delete)`
            : 'Delete annotation (Delete)'
        }
        className={`${buttonClass} bg-red-600 hover:bg-red-700`}
      >
        Delete
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={clearEditSession}
        title="Cancel (Esc)"
        className={`${buttonClass} bg-neutral-600 hover:bg-neutral-500`}
      >
        Cancel
      </button>
    </div>
  );
}
