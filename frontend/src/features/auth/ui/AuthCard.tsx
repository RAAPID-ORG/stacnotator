import type { ReactNode } from 'react';

interface AuthCardProps {
  children: ReactNode;
  /** Extra classes for the white card panel (e.g. `text-center`, `space-y-4`). */
  className?: string;
  /** Extra classes for the full-screen centering wrapper (e.g. `bg-canvas`). */
  outerClassName?: string;
}

/** Full-screen centered card used by the auth/onboarding screens. */
export const AuthCard = ({ children, className, outerClassName }: AuthCardProps) => (
  <div className={`h-screen w-screen flex items-center justify-center ${outerClassName ?? ''}`}>
    <div
      className={`bg-white border border-neutral-200 rounded-xl shadow-sm p-8 w-full max-w-md ${
        className ?? ''
      }`}
    >
      {children}
    </div>
  </div>
);
