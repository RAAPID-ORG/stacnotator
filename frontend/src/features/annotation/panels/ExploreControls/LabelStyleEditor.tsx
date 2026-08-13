import { type ExtendedLabel } from '../../domain/annotation';
import { resolveLabelStyle, type LabelStyle } from '../../domain/labelStyle';
import { usePrefsStore } from '../../stores/prefs';

export interface LabelStyleEditorProps {
  label: ExtendedLabel;
}

function Slider({
  title,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  title: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 flex-shrink-0">{title}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="w-9 text-right tabular-nums">{display}</span>
    </div>
  );
}

export function LabelStyleEditor({ label }: LabelStyleEditorProps) {
  const override = usePrefsStore((s) => s.labelStyles[label.id]);
  const setLabelStyle = usePrefsStore((s) => s.setLabelStyle);
  const resetLabelStyle = usePrefsStore((s) => s.resetLabelStyle);

  const resolved = resolveLabelStyle(label.color, label.geometry_type, override);
  const patch = (values: Partial<LabelStyle>) => setLabelStyle(label.id, values);

  return (
    <div className="flex flex-col gap-2 p-2.5 bg-neutral-50 border border-neutral-200 rounded text-[11px] text-neutral-600">
      <div className="flex items-center justify-between gap-2">
        <span>Fill</span>
        <input
          type="color"
          aria-label="Fill color"
          value={resolved.fillColor}
          onChange={(e) => patch({ fillColor: e.target.value })}
          className="w-7 h-6 rounded cursor-pointer border border-neutral-300 bg-white"
        />
      </div>
      <Slider
        title="Fill opacity"
        min={0}
        max={100}
        value={Math.round(resolved.fillOpacity * 100)}
        display={`${Math.round(resolved.fillOpacity * 100)}%`}
        onChange={(value: number) => patch({ fillOpacity: value / 100 })}
      />
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-neutral-200">
        <span>Border</span>
        <input
          type="color"
          aria-label="Border color"
          value={resolved.strokeColor}
          onChange={(e) => patch({ strokeColor: e.target.value })}
          className="w-7 h-6 rounded cursor-pointer border border-neutral-300 bg-white"
        />
      </div>
      <Slider
        title="Border opacity"
        min={0}
        max={100}
        value={Math.round(resolved.strokeOpacity * 100)}
        display={`${Math.round(resolved.strokeOpacity * 100)}%`}
        onChange={(value: number) => patch({ strokeOpacity: value / 100 })}
      />
      <Slider
        title="Border width"
        min={1}
        max={6}
        step={0.5}
        value={resolved.strokeWidth}
        display={`${resolved.strokeWidth}px`}
        onChange={(strokeWidth) => patch({ strokeWidth })}
      />
      <button
        type="button"
        onClick={() => resetLabelStyle(label.id)}
        className="self-start mt-0.5 text-[10px] text-neutral-500 hover:text-neutral-700 underline cursor-pointer"
      >
        Reset to default
      </button>
    </div>
  );
}
