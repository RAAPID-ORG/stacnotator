import { forwardRef } from 'react';

interface ToggleRowProps {
  option: string;
  label: string;
  title: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({ option, label, title, checked, onChange }: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-ts-option={option}
      className="w-full flex items-center justify-between gap-3 cursor-pointer select-none"
      title={title}
      onClick={() => onChange(!checked)}
    >
      <span className="text-[10px] text-neutral-700">{label}</span>
      <div
        className={`relative w-6 h-3.5 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-brand-600' : 'bg-neutral-300'}`}
      >
        <div
          className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-3' : 'translate-x-0.5'}`}
        />
      </div>
    </button>
  );
}

export interface SmoothingOptions {
  window: number;
  order: number;
}

export interface OptionsPopoverProps {
  removeCloudy: boolean;
  onRemoveCloudyChange: (v: boolean) => void;
  smoothEnabled: boolean;
  onSmoothEnabledChange: (v: boolean) => void;
  smoothing: SmoothingOptions;
  onSmoothingChange: (next: SmoothingOptions) => void;
  showDots: boolean;
  onShowDotsChange: (v: boolean) => void;
}

export const OptionsPopover = forwardRef<HTMLDivElement, OptionsPopoverProps>(
  function OptionsPopover(
    {
      removeCloudy,
      onRemoveCloudyChange,
      smoothEnabled,
      onSmoothEnabledChange,
      smoothing,
      onSmoothingChange,
      showDots,
      onShowDotsChange,
    },
    ref
  ) {
    return (
      <div
        ref={ref}
        className="absolute right-2 top-9 z-20 w-52 bg-white border border-neutral-200 rounded-lg shadow-lg p-2.5 space-y-2"
      >
        <ToggleRow
          option="remove-cloudy"
          label="Remove cloudy"
          title="Removes cloud-flagged days (shown as gray dots) from the series"
          checked={removeCloudy}
          onChange={onRemoveCloudyChange}
        />

        <ToggleRow
          option="smooth"
          label="Smooth"
          title="Savitzky-Golay Smoothing."
          checked={smoothEnabled}
          onChange={onSmoothEnabledChange}
        />
        {smoothEnabled && (
          <div className="flex items-center gap-2 pl-2">
            <label
              className="flex items-center gap-1"
              title="Window size for Savitzky-Golay smoothing (odd number >= 5, larger = smoother)"
            >
              <span className="text-[9px] text-neutral-500">W</span>
              <input
                type="number"
                min={5}
                max={31}
                step={2}
                value={smoothing.window}
                onChange={(e) => {
                  let v = parseInt(e.target.value, 10);
                  if (isNaN(v)) return;
                  v = Math.max(5, Math.min(31, v));
                  if (v % 2 === 0) v += 1;
                  // Ensure poly order stays valid for the new window.
                  const order = smoothing.order >= v ? Math.max(1, v - 2) : smoothing.order;
                  onSmoothingChange({ window: v, order });
                }}
                className="w-10 text-[9px] px-0.5 py-0 bg-white border border-neutral-300 rounded text-center"
              />
            </label>
            <label
              className="flex items-center gap-1"
              title="Polynomial order (>= 1, must be less than window size)"
            >
              <span className="text-[9px] text-neutral-500">P</span>
              <input
                type="number"
                min={1}
                max={Math.min(5, smoothing.window - 1)}
                value={smoothing.order}
                onChange={(e) => {
                  let v = parseInt(e.target.value, 10);
                  if (isNaN(v)) return;
                  v = Math.max(1, Math.min(smoothing.window - 1, v));
                  onSmoothingChange({ window: smoothing.window, order: v });
                }}
                className="w-10 text-[9px] px-0.5 py-0 bg-white border border-neutral-300 rounded text-center"
              />
            </label>
          </div>
        )}

        <ToggleRow
          option="dots"
          label="Dots"
          title="Show or hide the per-observation dots (line is always shown)"
          checked={showDots}
          onChange={onShowDotsChange}
        />
      </div>
    );
  }
);
