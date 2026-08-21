import { useState, type ReactNode } from 'react';

interface Explanation {
  /** The statistical justification, hidden until asked for. */
  technical?: ReactNode;
  /** Where in the literature it comes from. */
  source?: string;
}

/**
 * The wizard's teaching voice: the plain sentence always reads on its own, and
 * ends in a link that expands into why it is true. Written as a hook so the
 * link can sit inside a step's own paragraph rather than beside it, which is
 * the difference between an aside and a sentence a user will actually follow.
 */
const useLearnMore = ({ technical, source }: Explanation) => {
  const [open, setOpen] = useState(false);

  const link = (label: string) => (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className="font-medium text-blue-800 underline underline-offset-4 decoration-blue-300 hover:decoration-blue-600 cursor-pointer"
    >
      {label}
    </button>
  );

  return {
    /** Goes at the end of the sentence it explains. */
    inlineLink:
      technical && !open ? <> {link('Learn more about the statistics behind this.')}</> : null,
    /** Goes directly below that sentence, once asked for. */
    expansion:
      technical && open ? (
        <div className="mt-2 text-[13px] leading-relaxed text-neutral-600">
          {technical}
          {source && <p className="mt-2 text-[11px] italic text-neutral-500">{source}</p>}
          <p className="mt-2">{link('Show less')}</p>
        </div>
      ) : null,
  };
};

/** An aside a step raises itself, rather than one attached to its heading. */
export const Explain = ({ children, technical, source }: Explanation & { children: ReactNode }) => {
  const { inlineLink, expansion } = useLearnMore({ technical, source });
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] leading-relaxed text-blue-900">
      {children}
      {inlineLink}
      {expansion}
    </div>
  );
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
  technical,
  source,
  children,
}: Explanation & { title: string; children?: ReactNode }) => {
  const { inlineLink, expansion } = useLearnMore({ technical, source });
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

export const SubHeading = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div>
    <h3 className="text-sm font-medium text-neutral-900">{title}</h3>
    {children && <p className="mt-0.5 text-xs text-neutral-500 leading-snug">{children}</p>}
  </div>
);

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
    className={`w-full text-left border rounded-lg p-3 transition-colors ${
      disabled
        ? 'border-neutral-200 bg-neutral-50 opacity-60 cursor-not-allowed'
        : selected
          ? 'border-brand-600 bg-brand-50 cursor-pointer'
          : 'border-neutral-300 hover:border-neutral-400 cursor-pointer'
    }`}
  >
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-neutral-900">{title}</span>
      {badge}
    </div>
    {children && <div className="mt-1 text-xs text-neutral-600 leading-snug">{children}</div>}
  </button>
);
