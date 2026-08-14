import type { ReactNode } from 'react';

/** Transient status line over a map: zoom hints, imagery searches, loading. */
export function StatusPill({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute bottom-1.5 left-1/2 z-[1000] -translate-x-1/2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
      {children}
    </div>
  );
}

export function PillSpinner() {
  return (
    <span className="mr-1.5 inline-block h-2.5 w-2.5 animate-spin rounded-full border border-white/40 border-t-white align-middle" />
  );
}
