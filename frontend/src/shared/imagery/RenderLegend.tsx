import { useEffect, useState } from 'react';
import type { RenderConfig } from '~/api/client';
import { ColormapSelect } from '~/shared/colormaps/ColormapSelect';
import { gradientFor, isColormapName } from '~/shared/colormaps/colormaps';
import type { RenderOverride } from './tileColors';

/**
 * The colours a single-band raster is drawn with, editable in place.
 *
 * Draws in the surrounding text colour so the same legend reads on the
 * annotator's white card and on a visualizer's dark sidebar.
 */

const withHash = (color: string) => (color.startsWith('#') ? color : `#${color}`);

function formatTick(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(3)));
}

/**
 * Keeps its own draft text: a controlled numeric input cannot reach a negative
 * bound, because the intermediate "-" parses to NaN and [-1, 1] would be
 * untypable.
 */
function Tick({
  value,
  label,
  onCommit,
}: {
  value: number;
  label: string;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(formatTick(value));
  useEffect(() => setText(formatTick(value)), [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      aria-label={label}
      data-testid={`custom-map-legend-${label}`}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(parsed)) onCommit(parsed);
      }}
      className="w-9 border-0 border-b border-dashed border-current/40 bg-transparent p-0 text-inherit focus:border-brand-500 focus:outline-none"
    />
  );
}

function ContinuousBody({
  config,
  onChange,
  width,
}: {
  config: RenderConfig;
  onChange: (patch: RenderOverride) => void;
  width: string;
}) {
  const { rescale, colormap_name } = config;
  if (!colormap_name || !rescale || !isFinite(rescale[0]) || !isFinite(rescale[1])) return null;
  const [min, max] = rescale;

  return (
    <>
      {/* The colourbar is the control: an invisible select over it opens the list. */}
      <div className={`relative h-2.5 ${width}`}>
        <div
          className="absolute inset-0 rounded-sm"
          style={{ background: gradientFor(colormap_name) }}
        />
        {isColormapName(colormap_name) && (
          <ColormapSelect
            value={colormap_name}
            onChange={(name) => onChange({ colormap_name: name })}
            aria-label="Colormap"
            title="Change colormap"
            data-testid="custom-map-legend-colormap"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        )}
      </div>
      <div className={`mt-0.5 flex justify-between ${width}`}>
        <Tick value={min} label="min" onCommit={(n) => onChange({ rescale: [n, max] })} />
        <span className="opacity-60">{formatTick((min + max) / 2)}</span>
        <Tick value={max} label="max" onCommit={(n) => onChange({ rescale: [min, n] })} />
      </div>
    </>
  );
}

/** A class is hidden by drawing it fully transparent: the colormap the tiler
 *  is handed carries the alpha, so this needs nothing the legend cannot already
 *  express - and "reset colours" brings it back with everything else. */
const HIDDEN_ALPHA = '00';

const isHidden = (color: string) => withHash(color).slice(7).toLowerCase() === HIDDEN_ALPHA;

function CategoricalBody({
  config,
  onChange,
}: {
  config: RenderConfig;
  onChange: (patch: RenderOverride) => void;
}) {
  const entries = config.entries ?? [];
  const patchEntry = (value: number, color: string) =>
    onChange({ entries: entries.map((x) => (x.value === value ? { ...x, color } : x)) });

  return (
    <>
      {entries.map((entry) => {
        // <input type="color"> only speaks #rrggbb, so any stored alpha is
        // carried across untouched rather than silently dropped.
        const hex = withHash(entry.color);
        const rgb = hex.slice(0, 7);
        const alpha = hex.slice(7);
        const hidden = isHidden(entry.color);
        const name = entry.label || String(entry.value);
        return (
          <div key={entry.value} className="flex items-center gap-1">
            <input
              type="color"
              value={rgb}
              data-testid="custom-map-legend-color"
              onChange={(e) => patchEntry(entry.value, e.target.value + alpha)}
              title={`Recolour ${name}`}
              aria-label={`Colour for ${name}`}
              className={`h-3 w-3 cursor-pointer rounded-sm border-0 bg-transparent p-0 ${
                hidden ? 'opacity-25' : ''
              }`}
            />
            <button
              type="button"
              data-testid="custom-map-legend-class"
              data-hidden={hidden}
              onClick={() => patchEntry(entry.value, rgb + (hidden ? 'ff' : HIDDEN_ALPHA))}
              title={hidden ? `Show ${name}` : `Hide ${name}`}
              className={`cursor-pointer text-left text-inherit ${
                hidden ? 'line-through opacity-50' : ''
              }`}
            >
              {name}
            </button>
          </div>
        );
      })}
    </>
  );
}

export function RenderLegend({
  config,
  onChange,
  width = 'w-28',
}: {
  config: RenderConfig;
  onChange: (patch: RenderOverride) => void;
  /** Tailwind width for the colourbar, so a sidebar can run it full width. */
  width?: string;
}) {
  return config.mode === 'continuous' ? (
    <ContinuousBody config={config} onChange={onChange} width={width} />
  ) : (
    <CategoricalBody config={config} onChange={onChange} />
  );
}
