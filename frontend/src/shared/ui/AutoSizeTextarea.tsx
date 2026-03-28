import { useRef, useEffect, useCallback } from 'react';

interface AutoSizeTextareaProps {
  value: string;
  onChange: (val: string) => void;
  className?: string;
  placeholder?: string;
  minRows?: number;
}

export const AutoSizeTextarea = ({
  value,
  onChange,
  className,
  placeholder,
  minRows = 3,
}: AutoSizeTextareaProps) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.max(el.scrollHeight, 0) + 'px';
    }
  }, []);

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
      style={{ overflow: 'hidden' }}
    />
  );
};
