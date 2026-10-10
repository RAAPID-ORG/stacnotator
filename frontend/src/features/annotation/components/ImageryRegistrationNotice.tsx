import { PillSpinner } from './StatusPill';

export function ImageryRegistrationNotice() {
  return (
    <div
      role="status"
      data-testid="imagery-registration-notice"
      className="pointer-events-none absolute left-1/2 top-1/2 z-[1000] w-max max-w-[90%] -translate-x-1/2 -translate-y-1/2 rounded bg-black/70 px-3 py-2 text-center text-[11px] font-medium text-white"
    >
      <PillSpinner />
      Imagery registration in progress. Imagery will appear automatically.
    </div>
  );
}
