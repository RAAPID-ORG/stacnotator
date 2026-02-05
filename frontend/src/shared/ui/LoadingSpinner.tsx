export interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  fullScreen?: boolean;
}

const SIZE_CLASSES = {
  sm: { spinner: 'h-5 w-5', text: 'text-[10px]' },
  md: { spinner: 'h-8 w-8', text: 'text-sm' },
  lg: { spinner: 'h-12 w-12', text: 'text-base' },
} as const;

export const LoadingSpinner = ({ size = 'md', text, fullScreen = false }: LoadingSpinnerProps) => {
  const classes = SIZE_CLASSES[size];

  const spinner = (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`${classes.spinner} animate-spin rounded-full border-2 border-neutral-300 border-t-brand-600`}
      />
      {text && <span className={`${classes.text} text-neutral-600`}>{text}</span>}
    </div>
  );

  if (fullScreen) {
    return <div className="min-h-screen w-full flex items-center justify-center">{spinner}</div>;
  }

  return spinner;
};
