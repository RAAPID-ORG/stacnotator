import { useCampaignStore } from '../stores/campaign';
import { useWorkStore } from '../stores/work';
import { commitEdit, deleteSelection, useDrawingInteractions } from '../drawing';

const buttonClass =
  'px-2.5 py-1 rounded text-[11px] font-semibold text-white shadow disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors';

export function EditOverlayControls() {
  useDrawingInteractions();
  const isExplore = useCampaignStore((s) => s.workMode === 'explore');

  const selection = useWorkStore((s) => s.selection);
  const pending = useWorkStore((s) => s.edit?.pending ?? null);
  const busy = useWorkStore((s) => s.edit?.busy ?? false);

  if (!isExplore || selection.length === 0) return null;

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
          onClick={() => void commitEdit()}
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
        onClick={() => void deleteSelection()}
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
        onClick={() => useWorkStore.getState().clearEdit()}
        title="Cancel (Esc)"
        className={`${buttonClass} bg-neutral-600 hover:bg-neutral-500`}
      >
        Cancel
      </button>
    </div>
  );
}
