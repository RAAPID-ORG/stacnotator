import type { ReactNode } from 'react';

interface InlineAddActionProps {
  onClick: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * A quiet "add one of these" action that sits in a section heading.
 *
 * A filled or outlined button next to a heading competes with the section's own
 * content for attention, and every section grows one. This reads as text until it is
 * pointed at, then a dotted underline confirms it is a control - the same affordance a
 * glossary term or a footnote uses, which is why it can appear repeatedly without the
 * page turning into a wall of buttons.
 */
export const InlineAddAction = ({ onClick, children, className }: InlineAddActionProps) => (
  <button
    type="button"
    onClick={onClick}
    className={`group inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800 transition-colors ${className ?? ''}`}
  >
    {/* The dots span the whole control, plus sign included - underlining only the words
        leaves the + floating outside the thing it belongs to. */}
    <span className="dotted-underline inline-flex items-center gap-1">
      <span
        aria-hidden
        className="text-base leading-none transition-transform duration-300 ease-out group-hover:scale-110"
      >
        +
      </span>
      {children}
    </span>
  </button>
);
