import { Spinner, type SpinnerSize } from './Spinner';

export interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  fullScreen?: boolean;
}

const TEXT_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'text-[10px]',
  md: 'text-sm',
  lg: 'text-base',
};

export const LoadingSpinner = ({ size = 'md', text, fullScreen = false }: LoadingSpinnerProps) => {
  const spinner = (
    <div className="flex flex-col items-center gap-2">
      <Spinner size={size as SpinnerSize} />
      {text && <span className={`${TEXT_CLASSES[size]} text-neutral-600`}>{text}</span>}
    </div>
  );

  if (fullScreen) {
    return <div className="min-h-screen w-full flex items-center justify-center">{spinner}</div>;
  }

  return spinner;
};
