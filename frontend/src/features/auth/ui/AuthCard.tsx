import type { ReactNode } from 'react';
import { HarvestMark } from '~/shared/ui/HarvestMark';

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
      <div className="flex items-center gap-3 text-left border-b border-neutral-100 pb-4 mb-6">
        <HarvestMark className="h-10 w-10 shrink-0" />
        <div className="leading-tight">
          <div className="text-[13px] font-semibold text-neutral-900">STACNotator</div>
          <div className="text-[11px] text-neutral-500">by NASA Harvest</div>
        </div>
      </div>

      {children}
    </div>
  </div>
);
