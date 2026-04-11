import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';

/**
 * Form primitives. One source of truth for buttons, inputs, selects,
 * textareas, fields, and labels so the same field type always looks and
 * feels identical across the app.
 *
 * Visual language: warm cream canvas, brand-600 sage green for primary,
 * neutral-300 borders, brand focus ring, consistent h-9 height, rounded-md
 * corners, subtle shadow on primary CTAs. Quiet by default, deliberate when
 * interactive.
 *
 * Keep this file the only place that defines these classes. Anywhere in the
 * app that needs an input/button should import from here. If you find
 * yourself writing `border border-neutral-300 rounded-md px-3 py-2` inline,
 * stop and use <Input /> instead.
 */

// ─── Class strings ────────────────────────────────────────────────────────
//
// Exported so non-component contexts (e.g. integrating with a third-party
// widget) can apply the same look. Prefer the components below in JSX.

/** Shared base for inputs / selects / textareas - handles border, padding,
 *  focus ring, disabled state. */
const fieldBase =
  'w-full text-sm text-neutral-900 bg-white border border-neutral-300 rounded-md ' +
  'placeholder:text-neutral-400 ' +
  'focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15 ' +
  'disabled:bg-neutral-50 disabled:text-neutral-500 disabled:cursor-not-allowed ' +
  'transition-colors';

/** Single-line input height. Matches button height (h-9) so they line up. */
const fieldSingle = 'h-9 px-3';

/** Tailwind class for the standard input look (single-line). */
export const inputClass = `${fieldBase} ${fieldSingle}`;

/** Multiline (textarea) - vertical resize, generous min-height. */
export const textareaClass = `${fieldBase} px-3 py-2 resize-y min-h-[5rem]`;

/** Select - same as input but with a custom chevron via padding-right. */
export const selectClass =
  `${fieldBase} ${fieldSingle} pr-8 appearance-none cursor-pointer ` +
  "bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23737373%22%20d%3D%22M2%204l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] " +
  'bg-no-repeat bg-[right_0.625rem_center]';

// ─── Buttons ──────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Optional leading icon - rendered to the left of children with a small gap. */
  leading?: ReactNode;
  /** Optional trailing icon - rendered to the right of children. */
  trailing?: ReactNode;
}

const buttonBase =
  'inline-flex items-center justify-center gap-1.5 h-9 px-4 text-sm font-medium rounded-md ' +
  'transition-colors disabled:cursor-not-allowed select-none whitespace-nowrap';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-700 ' +
    'disabled:bg-neutral-300 disabled:text-neutral-500 disabled:shadow-none',
  secondary:
    'bg-white text-neutral-700 border border-neutral-300 shadow-sm hover:bg-neutral-50 ' +
    'disabled:bg-neutral-50 disabled:text-neutral-400 disabled:border-neutral-200',
  quiet:
    'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 ' +
    'disabled:text-neutral-400 disabled:hover:bg-transparent',
  danger:
    'bg-red-600 text-white shadow-sm hover:bg-red-700 ' +
    'disabled:bg-neutral-300 disabled:text-neutral-500 disabled:shadow-none',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', leading, trailing, className, children, type, ...rest }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={`${buttonBase} ${buttonVariants[variant]} ${className ?? ''}`}
      {...rest}
    >
      {leading}
      {children}
      {trailing}
    </button>
  )
);
Button.displayName = 'Button';

/** Returns the canonical class string for a button variant. Useful when you
 *  need a button-styled <a> or <Link> rather than a real <button>. */
export const buttonClass = (variant: ButtonVariant = 'primary', extra?: string) =>
  `${buttonBase} ${buttonVariants[variant]}${extra ? ' ' + extra : ''}`;

// ─── Inputs ───────────────────────────────────────────────────────────────

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Mark the field visually as invalid (red border + ring). */
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...rest }, ref) => (
    <input
      ref={ref}
      className={`${inputClass} ${
        invalid ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15' : ''
      } ${className ?? ''}`}
      {...rest}
    />
  )
);
Input.displayName = 'Input';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...rest }, ref) => (
    <textarea
      ref={ref}
      className={`${textareaClass} ${
        invalid ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15' : ''
      } ${className ?? ''}`}
      {...rest}
    />
  )
);
Textarea.displayName = 'Textarea';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, children, ...rest }, ref) => (
    <select
      ref={ref}
      className={`${selectClass} ${
        invalid ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15' : ''
      } ${className ?? ''}`}
      {...rest}
    >
      {children}
    </select>
  )
);
Select.displayName = 'Select';

// ─── Field wrapper (label + help + error) ────────────────────────────────

interface FieldProps {
  label?: ReactNode;
  /** Optional help text shown under the field in muted style. */
  hint?: ReactNode;
  /** Error message - takes precedence over hint when present. */
  error?: ReactNode;
  /** Marks the field as required (adds * to the label). */
  required?: boolean;
  /** Pin a label width so multiple horizontal fields align. */
  className?: string;
  children: ReactNode;
}

/**
 * Wraps a form control with a label, optional hint, and optional error.
 * Use this around any input/select/textarea so labels are consistent.
 *
 * <Field label="Display name" hint="Shown to other annotators">
 *   <Input value={name} onChange={...} />
 * </Field>
 */
export const Field = ({ label, hint, error, required, className, children }: FieldProps) => (
  <div className={`space-y-1.5 ${className ?? ''}`}>
    {label && (
      <label className="block text-xs font-medium text-neutral-700">
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </label>
    )}
    {children}
    {error ? (
      <p className="text-xs text-red-600">{error}</p>
    ) : hint ? (
      <p className="text-xs text-neutral-500 leading-snug">{hint}</p>
    ) : null}
  </div>
);

// ─── Toggle switch (peer-checkbox style) ─────────────────────────────────

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** Inline label rendered to the right of the switch. */
  label?: ReactNode;
  /** ARIA label when no visible label is provided. */
  'aria-label'?: string;
}

export const Switch = ({
  checked,
  onChange,
  disabled,
  label,
  ['aria-label']: ariaLabel,
}: SwitchProps) => (
  <label
    className={`inline-flex items-center gap-2 select-none ${
      disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
    }`}
  >
    <span className="relative">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
        aria-label={ariaLabel}
      />
      <span className="block w-8 h-4 bg-neutral-300 rounded-full peer-checked:bg-brand-600 peer-disabled:bg-neutral-200 transition-colors" />
      <span className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-transform" />
    </span>
    {label && <span className="text-xs text-neutral-700">{label}</span>}
  </label>
);
