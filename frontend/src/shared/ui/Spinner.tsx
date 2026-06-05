export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';
export type SpinnerVariant = 'brand' | 'white';

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  xs: 'h-4 w-4 border-2',
  sm: 'h-5 w-5 border-2',
  md: 'h-8 w-8 border-2',
  lg: 'h-12 w-12 border-2',
};

const VARIANT_CLASSES: Record<SpinnerVariant, string> = {
  brand: 'border-neutral-300 border-t-brand-600',
  white: 'border-white/30 border-t-white',
};

interface SpinnerProps {
  size?: SpinnerSize;
  variant?: SpinnerVariant;
  className?: string;
}

export const Spinner = ({ size = 'md', variant = 'brand', className }: SpinnerProps) => (
  <div
    className={`${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} animate-spin rounded-full ${
      className ?? ''
    }`}
  />
);
