import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';
import { IconChevronDown } from './Icons';

type Tone = 'neutral' | 'amber';

interface BarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ComponentType<{ className?: string }>;
  /** Omitted for an icon-only button, which then needs an aria-label. */
  label?: ReactNode;
  /** Opens a menu: a chevron follows the label. */
  menu?: boolean;
  /** Pressed, or its menu is open. */
  active?: boolean;
  tone?: Tone;
  /** Only the icon shows on touch devices, and in a bar (an `@container/bar`)
   *  too narrow for every label. */
  collapse?: boolean;
}

const tones: Record<Tone, { rest: string; active: string; icon: string; activeIcon: string }> = {
  neutral: {
    rest: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
    active: 'bg-neutral-100 text-neutral-900',
    icon: 'text-neutral-500',
    activeIcon: 'text-neutral-700',
  },
  amber: {
    rest: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
    active: 'bg-amber-50 text-amber-800 hover:bg-amber-100',
    icon: 'text-neutral-500',
    activeIcon: 'text-amber-600',
  },
};

/**
 * A control in a page's top bar: one height, one text size and one icon size
 * for every button there, labelled or icon-only, so a bar reads as one row.
 * It matches the sidebar's nav items (h-8, 13px, 16px outline icon), the other
 * chrome on every page. See docs/ui.md.
 */
export function BarButton({
  icon: Icon,
  label,
  menu = false,
  active = false,
  tone = 'neutral',
  collapse = false,
  className,
  type,
  ...rest
}: BarButtonProps) {
  const colors = tones[tone];
  // 1260px fits every label of the annotation toolbar, the widest bar.
  const collapsedLabel = collapse ? 'hidden desktop:@min-[1260px]/bar:inline' : '';
  const shape =
    label === undefined
      ? 'w-8 justify-center'
      : `gap-1.5 ${collapse ? 'px-2 desktop:@min-[1260px]/bar:px-2.5' : 'px-2.5'}`;
  return (
    <button
      type={type ?? 'button'}
      className={`inline-flex h-8 shrink-0 cursor-pointer items-center rounded-md text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${shape} ${
        active ? colors.active : colors.rest
      } ${className ?? ''}`}
      {...rest}
    >
      <Icon className={`h-4 w-4 shrink-0 ${active ? colors.activeIcon : colors.icon}`} />
      {label !== undefined && <span className={`truncate ${collapsedLabel}`}>{label}</span>}
      {menu && (
        <IconChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-neutral-400 ${collapse ? 'hidden desktop:@min-[1260px]/bar:block' : ''}`}
        />
      )}
    </button>
  );
}
