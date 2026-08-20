import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'brand' | 'green' | 'yellow' | 'red' | 'purple' | 'blue';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700 border-neutral-200',
  brand: 'bg-brand-50 text-brand-800 border-brand-200',
  green: 'bg-green-50 text-green-800 border-green-200',
  yellow: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  red: 'bg-red-50 text-red-800 border-red-200',
  purple: 'bg-purple-50 text-purple-800 border-purple-200',
  blue: 'bg-blue-50 text-blue-800 border-blue-200',
};

interface BadgeProps {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}

export const Badge = ({ tone = 'neutral', className, children }: BadgeProps) => (
  <span
    className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full border ${
      TONE_CLASSES[tone]
    } ${className ?? ''}`}
  >
    {children}
  </span>
);

/** A count that wants attention: the small red pill on the control that leads
 *  to whatever is waiting. Renders nothing when there is nothing to report. */
export const CountBadge = ({
  count,
  label,
  className,
}: {
  count: number;
  label: string;
  className?: string;
}) =>
  count <= 0 ? null : (
    <span
      data-testid="pending-count"
      aria-label={`${count} ${label}`}
      title={`${count} ${label}`}
      className={`inline-flex min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white ${
        className ?? ''
      }`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
