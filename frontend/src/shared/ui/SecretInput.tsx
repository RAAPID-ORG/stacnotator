import type { ReactNode } from 'react';
import { IconLock } from '~/shared/ui/Icons';
import { fieldClass } from '~/shared/ui/forms';

interface SecretInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  'aria-label': string;
  /** Short state shown inside the field's right edge: saved, missing, valid until... */
  status?: ReactNode;
  masked?: boolean;
}

/** A write-only secret: masked by default, never autofilled, with its state inside the field
 *  rather than in a row of its own. */
export const SecretInput = ({
  value,
  onChange,
  placeholder,
  'aria-label': ariaLabel,
  status,
  masked = true,
}: SecretInputProps) => (
  <div className="relative">
    <IconLock className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
    <input
      type={masked ? 'password' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      className={`${fieldClass('sm')} pl-8 font-mono ${status ? 'pr-28' : ''}`}
    />
    {status && (
      <span className="pointer-events-none absolute right-2.5 top-1/2 max-w-[6.5rem] -translate-y-1/2 truncate text-[11px]">
        {status}
      </span>
    )}
  </div>
);

export const SecretStatus = ({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'error' | 'muted';
  children: ReactNode;
}) => {
  const color = {
    ok: 'text-emerald-600',
    warn: 'text-amber-600',
    error: 'text-red-600',
    muted: 'text-neutral-400',
  }[tone];
  return <span className={color}>{children}</span>;
};
