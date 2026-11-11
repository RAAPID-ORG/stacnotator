import type { ComponentType, ReactNode } from 'react';

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  Icon?: ComponentType<{ className?: string }>;
  disabled?: boolean;
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  /** `bar` is the flat, borderless strip used in a page's top bar; `compact` fills
   *  its row with short, small-type segments, for dense panels; `icon` is `bar`
   *  for icon-only segments, which carry their name in `title`. */
  size?: 'form' | 'bar' | 'compact' | 'icon';
  title?: string;
  'data-testid'?: string;
}

const SEGMENT_SIZE = {
  form: 'h-7 px-2.5 text-xs',
  bar: 'h-6 px-2.5 text-xs',
  compact: 'h-5 flex-1 justify-center px-2 text-[10px]',
  icon: 'h-6 w-6 justify-center',
};

/** A choice between a few peers, shown side by side as one control. */
export const SegmentedControl = <T extends string>({
  segments,
  value,
  onChange,
  'aria-label': ariaLabel,
  size = 'form',
  title,
  'data-testid': testId,
}: SegmentedControlProps<T>) => (
  <div
    role="radiogroup"
    aria-label={ariaLabel}
    title={title}
    data-testid={testId}
    className={`rounded-md p-0.5 ${size === 'compact' ? 'flex w-full' : 'inline-flex shrink-0'} ${
      size === 'bar' || size === 'icon'
        ? 'bg-neutral-100'
        : 'border border-neutral-200 bg-neutral-50'
    }`}
  >
    {segments.map(({ value: option, label, Icon, disabled, title: segmentTitle }) => {
      const selected = option === value;
      return (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={selected}
          disabled={disabled}
          title={segmentTitle}
          onClick={() => onChange(option)}
          className={`inline-flex items-center gap-1.5 rounded transition-colors cursor-pointer disabled:cursor-not-allowed disabled:text-neutral-300 ${
            SEGMENT_SIZE[size]
          } ${
            selected
              ? `bg-white text-neutral-900 shadow-sm ${size === 'bar' || size === 'icon' ? '' : 'ring-1 ring-neutral-200'}`
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
