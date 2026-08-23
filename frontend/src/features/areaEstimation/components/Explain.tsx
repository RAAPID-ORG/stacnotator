/**
 * The small pieces every screen of this feature is written with: headings that
 * can explain themselves, notes, and the choice card. There is no standalone
 * explainer component - an explanation belongs to the text it explains, so the
 * headings carry it.
 */
import { useState, type ReactNode } from 'react';

/**
 * The wizard's inline offer to expand something, deliberately quieter than the
 * sentence it hangs off: an offer, not a competing headline. Exported because
 * a few expansions hold a form control and cannot go through the hook below.
 */
export const expandLinkCls =
  'cursor-pointer text-xs text-brand-700 underline decoration-brand-300 underline-offset-4 hover:decoration-brand-600';

interface Explanation {
  /** The statistical justification, hidden until asked for. */
  technical?: ReactNode;
  /** Where in the literature it comes from. */
  source?: string;
  /** Overrides the offer, for an expansion that is not about the statistics. */
  moreLabel?: string;
}

/**
 * The wizard's teaching voice: the plain sentence always reads on its own, and
 * ends in a link that expands into why it is true. Written as a hook so the
 * link can sit inside a step's own paragraph rather than beside it, which is
 * the difference between an aside and a sentence a user will actually follow.
 */
const useLearnMore = ({ technical, source, moreLabel }: Explanation) => {
  const [open, setOpen] = useState(false);

  const link = (label: string) => (
    <button type="button" onClick={() => setOpen(!open)} className={expandLinkCls}>
      {label}
    </button>
  );

  return {
    /** Goes at the end of the sentence it explains. */
    inlineLink:
      technical && !open ? (
        <> {link(moreLabel ?? 'Learn more about the statistics behind this.')}</>
      ) : null,
    /** Goes directly below that sentence, once asked for. */
    expansion:
      technical && open ? (
        <div className="mt-2 text-xs leading-relaxed text-neutral-500">
          {technical}
          {source && <p className="mt-2 text-[11px] italic text-neutral-400">{source}</p>}
          <p className="mt-2">{link('Show less')}</p>
        </div>
      ) : null,
  };
};

export const Note = ({ tone, children }: { tone: 'warning' | 'error'; children: ReactNode }) => (
  <div
    className={`rounded-lg border px-4 py-3 text-[13px] leading-relaxed ${
      tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-red-200 bg-red-50 text-red-800'
    }`}
  >
    {children}
  </div>
);

export const StepHeading = ({
  title,
  children,
  ...explanation
}: Explanation & { title: string; children?: ReactNode }) => {
  const { inlineLink, expansion } = useLearnMore(explanation);
  return (
    <div>
      <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
      {children && (
        <p className="mt-1 text-sm text-neutral-500 leading-relaxed">
          {children}
          {inlineLink}
        </p>
      )}
      {expansion}
    </div>
  );
};

export const SubHeading = ({
  title,
  children,
  ...explanation
}: Explanation & { title: string; children?: ReactNode }) => {
  const { inlineLink, expansion } = useLearnMore(explanation);
  return (
    <div>
      <h3 className="text-sm font-medium text-neutral-900">{title}</h3>
      {children && (
        <p className="mt-0.5 text-xs text-neutral-500 leading-snug">
          {children}
          {inlineLink}
        </p>
      )}
      {expansion}
    </div>
  );
};

/**
 * The card chrome on its own, for the one card that holds an input and so
 * cannot be a button.
 */
export const choiceCardCls = (selected: boolean, disabled = false) =>
  `w-full text-left border rounded-lg p-3 transition-colors ${
    disabled
      ? 'border-neutral-200 bg-neutral-50 opacity-60 cursor-not-allowed'
      : selected
        ? 'border-brand-600 bg-brand-50 cursor-pointer'
        : 'border-neutral-300 hover:border-neutral-400 cursor-pointer'
  }`;

/** Radio card, the established way this app offers a small set of choices. */
export const ChoiceCard = ({
  selected,
  onSelect,
  title,
  badge,
  children,
  disabled,
  testId,
}: {
  selected: boolean;
  onSelect: () => void;
  title: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
  testId?: string;
}) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onSelect}
    disabled={disabled}
    aria-pressed={selected}
    className={choiceCardCls(selected, disabled)}
  >
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-neutral-900">{title}</span>
      {badge}
    </div>
    {children && <div className="mt-1 text-xs text-neutral-600 leading-snug">{children}</div>}
  </button>
);
