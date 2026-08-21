import { useState, type ReactNode } from 'react';

/**
 * The wizard's teaching voice. The plain sentence is always visible; the
 * statistical justification is one click away and stays out of the way of a
 * user who only wants a crop area for their country.
 */
export const Explain = ({
  children,
  technical,
  source,
}: {
  children: ReactNode;
  technical?: ReactNode;
  source?: string;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] leading-relaxed text-blue-900">
      <div>{children}</div>
      {technical && (
        <>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="mt-2 text-xs font-medium text-blue-800 underline underline-offset-4 decoration-blue-300 hover:decoration-blue-600 cursor-pointer"
          >
            {open ? 'Hide the statistics' : 'The statistics behind this'}
          </button>
          {open && (
            <div className="mt-2 border-t border-blue-200 pt-2 text-xs leading-relaxed text-blue-800">
              {technical}
              {source && <p className="mt-2 text-[11px] text-blue-700 italic">{source}</p>}
            </div>
          )}
        </>
      )}
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

export const StepHeading = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div>
    <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
    {children && <p className="mt-1 text-sm text-neutral-500 leading-relaxed">{children}</p>}
  </div>
);

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
