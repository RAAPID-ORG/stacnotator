import { useRef, useEffect, useCallback, useState } from 'react';

interface AutoSizeTextareaProps {
  value: string;
  onChange: (val: string) => void;
  className?: string;
  placeholder?: string;
  minRows?: number;
  /** Cap the auto-grow at this many rows. Beyond it, the textarea scrolls
   *  internally instead of pushing the page down. Defaults to 8. */
  maxRows?: number;
}

export const AutoSizeTextarea = ({
  value,
  onChange,
  className,
  placeholder,
  minRows = 3,
  maxRows = 8,
}: AutoSizeTextareaProps) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [capped, setCapped] = useState(false);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 16;
    const padding =
      parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom);
    const maxHeight = line * maxRows + padding;
    const desired = Math.max(el.scrollHeight, 0);
    if (desired > maxHeight) {
      el.style.height = maxHeight + 'px';
      setCapped(true);
    } else {
      el.style.height = desired + 'px';
      setCapped(false);
    }
  }, [maxRows]);

  useEffect(() => {
    resize();
    const raf = requestAnimationFrame(resize);
    return () => cancelAnimationFrame(raf);
  }, [value, resize]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={resize}
      placeholder={placeholder}
      className={className}
      rows={minRows}
      style={{ overflow: capped ? 'auto' : 'hidden' }}
    />
  );
};
