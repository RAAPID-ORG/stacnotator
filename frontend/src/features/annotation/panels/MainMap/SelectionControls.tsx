import { useCanModifyAnnotation } from '../../stores/campaign';
import { useWorkStore } from '../../stores/work';
import { commitEdit, deleteSelection } from '../../drawing';

const buttonClass =
  'pointer-events-auto rounded-full p-1.5 text-white shadow-lg transition-all hover:scale-110 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 cursor-pointer';

const CHECK_PATH = 'M20 6L9 17l-5-5';
const TRASH_PATH =
  'M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2';
const CLOSE_PATH = 'M18 6L6 18M6 6l12 12';

const Icon = ({ path }: { path: string }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
  >
    <path d={path} />
  </svg>
);

/**
 * Confirm / delete / cancel for the current selection, anchored on the
 * geometry itself so the buttons are where the user is already looking.
 */
export function SelectionControls() {
  const selection = useWorkStore((s) => s.selection);
  const annotation = useWorkStore((s) => s.edit?.annotation ?? null);
  const pending = useWorkStore((s) => s.edit?.pending ?? null);
  const busy = useWorkStore((s) => s.edit?.busy ?? false);
  const canModify = useCanModifyAnnotation();

  if (selection.length === 0) return null;

  // A box selection carries ids only, so ownership is the server's answer
  // there; a single open annotation is known, and someone else's offers
  // nothing to press.
  const readOnly = annotation !== null && !canModify(annotation);

  return (
    <div
      data-testid="edit-controls"
      data-selected-count={selection.length}
      className="flex items-center gap-1"
    >
      {selection.length > 1 && (
        <span className="rounded-full bg-neutral-800 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white shadow-lg tabular-nums">
          {selection.length}
        </span>
      )}
      {pending && !readOnly && (
        <button
          type="button"
          data-testid="edit-confirm-btn"
          disabled={busy}
          onClick={() => void commitEdit()}
          title="Confirm edits (Enter)"
          className={`${buttonClass} bg-green-500 hover:bg-green-600`}
        >
          <Icon path={CHECK_PATH} />
        </button>
      )}
      {!readOnly && (
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
          className={`${buttonClass} bg-red-500 hover:bg-red-600`}
        >
          <Icon path={TRASH_PATH} />
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => useWorkStore.getState().clearEdit()}
        title="Cancel (Esc)"
        className={`${buttonClass} bg-neutral-700 hover:bg-neutral-600`}
      >
        <Icon path={CLOSE_PATH} />
      </button>
    </div>
  );
}
