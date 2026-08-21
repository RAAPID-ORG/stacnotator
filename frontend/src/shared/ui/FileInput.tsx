import { forwardRef, type InputHTMLAttributes } from 'react';

interface FileInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onSelect'> {
  /** Called with the chosen file. The native input is reset so the same file can be picked twice. */
  onSelect: (file: File) => void;
  /** Text on the button part. */
  action?: string;
  /** Shown beside the button when nothing is chosen. */
  placeholder?: string;
  /** Name of the file already chosen, if the caller is tracking one. */
  fileName?: string | null;
  /** Replaces the file name while something is happening to it. */
  busyText?: string;
}

/**
 * The one way this app asks for a file. A native input styled as a field so it
 * sits with the other form controls instead of looking like a browser default.
 */
export const FileInput = forwardRef<HTMLInputElement, FileInputProps>(
  (
    {
      onSelect,
      action = 'Choose file',
      placeholder = 'No file selected',
      fileName,
      busyText,
      disabled,
      className,
      ...rest
    },
    ref
  ) => (
    <label
      className={`relative flex items-center gap-3 h-9 px-1 pr-3 border border-neutral-300 rounded-md bg-white transition-colors ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-neutral-400'
      } ${className ?? ''}`}
    >
      <input
        ref={ref}
        type="file"
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onSelect(file);
        }}
        {...rest}
      />
      <span className="inline-flex items-center h-7 px-3 rounded text-xs font-medium bg-neutral-100 text-neutral-700 shrink-0">
        {action}
      </span>
      <span className="text-xs text-neutral-500 truncate">
        {busyText ?? fileName ?? placeholder}
      </span>
    </label>
  )
);
FileInput.displayName = 'FileInput';
