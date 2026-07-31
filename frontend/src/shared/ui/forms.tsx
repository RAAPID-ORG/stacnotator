import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';

// Single source of truth for form primitives. Import from here instead of
// writing `border border-neutral-300 rounded-md px-3 py-2` inline.

export type FieldSize = 'sm' | 'md';

const fieldBase =
  'w-full text-neutral-900 bg-white border border-neutral-300 rounded-md ' +
  'placeholder:text-neutral-400 ' +
  'focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15 ' +
  'disabled:bg-neutral-50 disabled:text-neutral-500 disabled:cursor-not-allowed ' +
  'transition-colors';

// Per-size dimensions for single-line fields (input/select) and textareas.
const fieldSingleSize: Record<FieldSize, string> = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-3 text-sm',
};

const fieldAreaSize: Record<FieldSize, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3 py-2 text-sm',
};

const selectChevron =
  "pr-8 appearance-none cursor-pointer bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23737373%22%20d%3D%22M2%204l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] " +
  'bg-no-repeat bg-[right_0.625rem_center]';

export const fieldClass = (size: FieldSize = 'md') => `${fieldBase} ${fieldSingleSize[size]}`;

export const inputClass = fieldClass('md');

export const textareaClass = `${fieldBase} ${fieldAreaSize.md} resize-y min-h-[5rem]`;

export const selectClass = `${fieldBase} ${fieldSingleSize.md} ${selectChevron}`;

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: FieldSize;
  leading?: ReactNode;
  trailing?: ReactNode;
}

const buttonBase =
  'inline-flex items-center justify-center gap-1.5 font-medium rounded-md ' +
  'transition-colors disabled:cursor-not-allowed select-none whitespace-nowrap';

const buttonSize: Record<FieldSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
};

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
  (
    { variant = 'primary', size = 'md', leading, trailing, className, children, type, ...rest },
    ref
  ) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={`${buttonBase} ${buttonSize[size]} ${buttonVariants[variant]} ${className ?? ''}`}
      {...rest}
    >
      {leading}
      {children}
      {trailing}
    </button>
  )
);
Button.displayName = 'Button';

export const buttonClass = (variant: ButtonVariant = 'primary', extra?: string) =>
  `${buttonBase} ${buttonSize.md} ${buttonVariants[variant]}${extra ? ' ' + extra : ''}`;

export type IconButtonTone = 'neutral' | 'danger' | 'brand';

const iconButtonTones: Record<IconButtonTone, string> = {
  neutral: 'text-neutral-400 hover:text-neutral-700',
  danger: 'text-red-400 hover:text-red-600',
  brand: 'text-neutral-500 hover:text-brand-600',
};

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: IconButtonTone;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ tone = 'neutral', className, type, children, ...rest }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={`inline-flex items-center justify-center rounded p-0.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${iconButtonTones[tone]} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </button>
  )
);
IconButton.displayName = 'IconButton';

const invalidClass = 'border-red-400 focus:border-red-500 focus:ring-red-500/15';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  invalid?: boolean;
  size?: FieldSize;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, size = 'md', ...rest }, ref) => (
    <input
      ref={ref}
      className={`${fieldBase} ${fieldSingleSize[size]} ${invalid ? invalidClass : ''} ${
        className ?? ''
      }`}
      {...rest}
    />
  )
);
Input.displayName = 'Input';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  size?: FieldSize;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, size = 'md', ...rest }, ref) => (
    <textarea
      ref={ref}
      className={`${fieldBase} ${fieldAreaSize[size]} resize-y min-h-[5rem] ${
        invalid ? invalidClass : ''
      } ${className ?? ''}`}
      {...rest}
    />
  )
);
Textarea.displayName = 'Textarea';

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  invalid?: boolean;
  size?: FieldSize;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, size = 'md', children, ...rest }, ref) => (
    <select
      ref={ref}
      className={`${fieldBase} ${fieldSingleSize[size]} ${selectChevron} ${
        invalid ? invalidClass : ''
      } ${className ?? ''}`}
      {...rest}
    >
      {children}
    </select>
  )
);
Select.displayName = 'Select';

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  htmlFor?: string;
  children: ReactNode;
}

export const Field = ({
  label,
  hint,
  error,
  required,
  className,
  htmlFor,
  children,
}: FieldProps) => (
  <div className={`space-y-1.5 ${className ?? ''}`}>
    {label && (
      <label htmlFor={htmlFor} className="block text-xs font-medium text-neutral-700">
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

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
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
