import type { ComponentType, ReactNode } from 'react';

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  Icon?: ComponentType<{ className?: string }>;
}

interface SegmentedControlProps<T extends string> {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
}

/** A choice between a few peers, shown side by side as one control. */
export const SegmentedControl = <T extends string>({
  segments,
  value,
  onChange,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) => (
  <div
    role="radiogroup"
    aria-label={ariaLabel}
    className="inline-flex rounded-md border border-neutral-200 bg-neutral-50 p-0.5"
  >
    {segments.map(({ value: option, label, Icon }) => {
      const selected = option === value;
      return (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={selected}
          onClick={() => onChange(option)}
          className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs transition-colors cursor-pointer ${
            selected
              ? 'bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200'
              : 'text-neutral-500 hover:text-neutral-800'
          }`}
        >
          {Icon && (
            <Icon className={`h-3.5 w-3.5 ${selected ? 'text-brand-600' : 'text-neutral-400'}`} />
          )}
          {label}
        </button>
      );
    })}
  </div>
);
