/**
 * Notes about one imagery slice: the button that sits in every map header and
 * the dialog it opens. The page mounts the dialog once; the button is
 * wherever a slice is on screen.
 */
import { useEffect, useRef, useState } from 'react';
import { IconComment, IconCommentFilled } from '~/shared/ui/Icons';
import { Modal } from '~/shared/ui/Modal';
import { sliceLabel } from '../campaign/imagery';
import type { SliceAddress } from '../campaign/imageryNav';
import { sliceCommentAt, sliceIdAt } from '../campaign/sliceComments';
import { useCatalog } from '../stores/campaign';
import { useSliceNotes, useWorkStore } from '../stores/work';

/** Marks a slice that carries a note, in the lists that offer slices. */
export const NoteBadge = () => (
  <span title="Has a note" className="text-amber-500">
    <IconCommentFilled className="w-2.5 h-2.5" />
  </span>
);

export interface SliceCommentButtonProps {
  address: SliceAddress | null;
  /** Appended to the tooltip so each header can name its own way in. */
  hint?: string;
  compact?: boolean;
}

export function SliceCommentButton({ address, hint, compact }: SliceCommentButtonProps) {
  const catalog = useCatalog();
  const notes = useSliceNotes();
  const openSliceComment = useWorkStore((s) => s.openSliceComment);
  if (!address) return null;

  const sliceId = sliceIdAt(catalog, address.collectionId, address.sliceIndex);
  const note = sliceId === null ? undefined : notes[sliceId];
  const size = compact ? 'h-5 w-5' : 'h-6 w-6';
  const icon = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';

  return (
    <button
      type="button"
      // The header is the panel's drag handle; a press here must not drag it.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        openSliceComment(address);
      }}
      data-slice-comment-open
      data-has-note={note !== undefined}
      aria-label="Comment on this imagery"
      title={
        note ? `Note: ${note.text}` : ['Comment on this imagery', hint].filter(Boolean).join(' - ')
      }
      className={`flex ${size} shrink-0 items-center justify-center rounded-md cursor-pointer transition-colors ${
        note
          ? 'text-amber-600 hover:bg-amber-50'
          : 'text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500'
      }`}
    >
      {note ? <IconCommentFilled className={icon} /> : <IconComment className={icon} />}
    </button>
  );
}

export function SliceCommentDialog() {
  const catalog = useCatalog();
  const notes = useSliceNotes();
  const address = useWorkStore((s) => s.commenting);
  const close = useWorkStore((s) => s.closeSliceComment);

  const sliceId = address && sliceIdAt(catalog, address.collectionId, address.sliceIndex);
  const stored = sliceId == null ? undefined : notes[sliceId];
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!address) return;
    setText(stored?.text ?? '');
    inputRef.current?.focus();
    // Seeded once per opening - closing clears `commenting`, so reopening the
    // same slice is a new identity and starts from the stored note again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  if (!address || sliceId == null) return null;

  const collection = catalog.collections.get(address.collectionId);
  const slice = collection?.slices[address.sliceIndex];
  const source = catalog.sources.get(address.sourceId);
  const subject = [source?.name, collection?.name, slice && sliceLabel(slice, address.sliceIndex)]
    .filter(Boolean)
    .join(' - ');

  const save = () => {
    const comment = sliceCommentAt(catalog, address, text);
    if (comment) void useWorkStore.getState().saveSliceComment(comment);
    close();
  };

  return (
    <Modal
      title="Imagery note"
      onClose={close}
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setText('');
              inputRef.current?.focus();
            }}
            disabled={!text}
            className="text-[11px] text-neutral-500 hover:text-rose-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            Clear
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-neutral-700 border border-neutral-300 hover:bg-neutral-50 cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="slice-comment-save"
              onClick={save}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 cursor-pointer transition-colors"
            >
              {stored && !text.trim() ? 'Remove' : 'Save'}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-2 px-5 py-4">
        <span className="text-[11px] text-neutral-500" data-testid="slice-comment-subject">
          {subject}
        </span>
        <textarea
          ref={inputRef}
          data-slice-comment-input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
            e.stopPropagation();
          }}
          placeholder="What is worth knowing about this imagery?"
          rows={4}
          maxLength={2000}
          className="w-full resize-none rounded-md border border-neutral-300 px-2.5 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
        />
        <span className="text-[10px] text-neutral-400">
          Saved with your annotation. Ctrl+Enter to save.
        </span>
      </div>
    </Modal>
  );
}
