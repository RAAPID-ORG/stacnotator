import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface PointJumperProps {
  current: number;
  disabled?: boolean;
  /** False when no point with that number is in the current filter. */
  onJump: (annotationNumber: number) => boolean;
  onNotFound: (annotationNumber: number) => void;
}

/** The current point's number, editable in place to jump elsewhere - the
 *  page box of a document viewer. Focus selects it so typing replaces it;
 *  Enter or leaving the field jumps, Escape puts it back. Whatever happens,
 *  it ends up showing the point actually on screen, never a number typed and
 *  abandoned. Key it on `current` so a move made elsewhere resets it. */
export function PointJumper({ current, disabled, onJump, onNotFound }: PointJumperProps) {
  const { t } = useTranslation('panels');
  const [draft, setDraft] = useState(String(current));
  const cancelled = useRef(false);

  const commit = () => {
    const num = Number(draft);
    setDraft(String(current));
    if (draft === '' || !Number.isInteger(num) || num < 1 || num === current) return;
    if (!onJump(num)) onNotFound(num);
  };

  return (
    <input
      data-testid="goto-point"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          setDraft(String(current));
          return;
        }
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        cancelled.current = e.key === 'Escape';
        e.currentTarget.blur();
      }}
      aria-label={t('task.currentPoint')}
      title={t('task.currentPointTitle')}
      className="w-14 h-7 shrink-0 px-1 text-center text-xs text-neutral-900 bg-white border border-neutral-300 rounded hover:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-400 disabled:opacity-50 tabular-nums cursor-text"
    />
  );
}
