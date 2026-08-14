import { useEffect, useState } from 'react';
import type { RenderConfig } from '~/api/client';
import { ColormapSelect } from '~/shared/colormaps/ColormapSelect';
import { gradientFor, isColormapName } from '~/shared/colormaps/colormaps';
import { type ImageryCatalog } from '../../../campaign/imagery';
import {
  effectiveRenderConfig,
  isCustomized,
  readyCustomMaps,
  type RenderOverride,
} from '../../../campaign/renderConfig';
import { useImageryStore } from '../../../stores/imagery';
import { usePrefsStore } from '../../../stores/prefs';

const withHash = (color: string) => (color.startsWith('#') ? color : `#${color}`);

function formatTick(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(3)));
}

/**
 * Editable in place, with its own draft text. A controlled numeric input
 * cannot reach a negative bound: the intermediate "-" parses to NaN, state
 * [-1, 1] would be untypable.
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
      className="w-9 border-0 border-b border-dashed border-neutral-300 bg-transparent p-0 text-inherit focus:border-brand-500 focus:outline-none"
    />
  );
}

function ContinuousBody({
  config,
  onChange,
}: {
  config: RenderConfig;
  onChange: (patch: RenderOverride) => void;
}) {
  const { rescale, colormap_name } = config;
  if (!colormap_name || !rescale || !isFinite(rescale[0]) || !isFinite(rescale[1])) return null;
  const [min, max] = rescale;

  return (
    <>
      {/* The colourbar is the control: an invisible select over it opens the list. */}
      <div className="relative h-2.5 w-28">
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
      <div className="mt-0.5 flex w-28 justify-between">
        <Tick value={min} label="min" onCommit={(n) => onChange({ rescale: [n, max] })} />
        <span className="text-neutral-400">{formatTick((min + max) / 2)}</span>
        <Tick value={max} label="max" onCommit={(n) => onChange({ rescale: [min, n] })} />
      </div>
    </>
  );
}

function CategoricalBody({
  config,
  onChange,
}: {
  config: RenderConfig;
  onChange: (patch: RenderOverride) => void;
}) {
  const entries = config.entries ?? [];
  return (
    <>
      {entries.map((entry) => {
        // <input type="color"> only speaks #rrggbb, so any stored alpha is
        // carried across untouched rather than silently dropped.
        const hex = withHash(entry.color);
        const alpha = hex.slice(7);
        return (
          <div key={entry.value} className="flex items-center gap-1">
            <input
              type="color"
              value={hex.slice(0, 7)}
              data-testid="custom-map-legend-color"
              onChange={(e) =>
                onChange({
                  entries: entries.map((x) =>
                    x.value === entry.value ? { ...x, color: e.target.value + alpha } : x
                  ),
                })
              }
              title={`Recolour ${entry.label || entry.value}`}
              aria-label={`Colour for ${entry.label || entry.value}`}
              className="h-3 w-3 cursor-pointer rounded-sm border-0 bg-transparent p-0"
            />
            <span>{entry.label ?? String(entry.value)}</span>
          </div>
        );
      })}
    </>
  );
}

export interface CustomMapLegendProps {
  catalog: ImageryCatalog;
}

export function CustomMapLegend({ catalog }: CustomMapLegendProps) {
  const overlay = useImageryStore((s) => s.overlay);
  // Per view, like the overlay selection: switching views (U) restores the
  // opacity that view was left at.
  const opacity = useImageryStore((s) => s.overlayOpacity);
  const setOverlayOpacity = useImageryStore((s) => s.setOverlayOpacity);
  const overrides = usePrefsStore((s) => s.legendOverrides);
  const setLegendOverride = usePrefsStore((s) => s.setLegendOverride);
  const resetLegendOverride = usePrefsStore((s) => s.resetLegendOverride);

  const map = readyCustomMaps([...catalog.customMaps.values()]).find((m) => m.id === overlay.id);
  if (!map || !overlay.visible) return null;

  const override = overrides[map.id];
  const config = effectiveRenderConfig(map.render_config, override);
  const customized = isCustomized(map.render_config, override);
  const Body = config.mode === 'continuous' ? ContinuousBody : CategoricalBody;

  return (
    <div
      className="absolute bottom-2 right-2 rounded bg-white/90 p-2 text-xs shadow"
      data-testid="custom-map-legend"
      data-customized={customized}
    >
      <div className="max-h-48 overflow-y-auto pr-1">
        <Body
          config={config}
          onChange={(patch) => setLegendOverride(map.id, { ...override, ...patch })}
        />
      </div>

      {customized && (
        <button
          type="button"
          onClick={() => resetLegendOverride(map.id)}
          data-testid="custom-map-legend-reset"
          title="Go back to the colours set for this campaign"
          className="mt-1.5 cursor-pointer text-[10px] text-neutral-500 underline hover:text-neutral-800"
        >
          Reset colours
        </button>
      )}

      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(opacity * 100)}
        data-testid="custom-map-opacity"
        onChange={(e) => setOverlayOpacity(Number(e.target.value) / 100)}
        title="Overlay opacity"
        className="mt-1.5 block w-28 cursor-pointer accent-brand-500"
      />
    </div>
  );
}
