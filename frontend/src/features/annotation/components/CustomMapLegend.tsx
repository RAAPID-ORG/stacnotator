import { useEffect, useState } from 'react';
import { useMapStore } from '../stores/map.store';
import { usePreferencesStore } from '../stores/preferences.store';
import type { CustomMapOut, RenderConfig } from '~/api/client';
import { ColormapSelect } from '~/shared/ui/ColormapSelect';
import { gradientFor, formatTick, isColormapName } from '~/shared/utils/customMapColormaps';
import {
  effectiveRenderConfig,
  isCustomized,
  type RenderOverride,
} from '../utils/customMapOverride';

const withHash = (color: string) => (color.startsWith('#') ? color : `#${color}`);

/**
 * Editable in place, with its own draft text. A controlled numeric input cannot reach a
 * negative bound: the intermediate "-" parses to NaN, state never moves, and React restores
 * the old value - so rescales like NDVI's [-1, 1] would be untypable.
 */
function Tick({
  value,
  onCommit,
  label,
}: {
  value: number;
  onCommit: (n: number) => void;
  label: string;
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
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onCommit(n);
      }}
      className="w-9 border-0 border-b border-dashed border-neutral-300 bg-transparent p-0 text-inherit hover:border-neutral-500 focus:border-brand-500 focus:outline-none"
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
      {/* The colourbar is the control: an invisible select over it opens the colormap list. */}
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
        <Tick value={min} onCommit={(n) => onChange({ rescale: [n, max] })} label="min" />
        <span className="text-neutral-400">{formatTick((min + max) / 2)}</span>
        <Tick value={max} onCommit={(n) => onChange({ rescale: [min, n] })} label="max" />
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

  const setColor = (value: number, color: string) =>
    onChange({ entries: entries.map((e) => (e.value === value ? { ...e, color } : e)) });

  return (
    <>
      {entries.map((e) => {
        // <input type="color"> only speaks #rrggbb, so carry any stored alpha across untouched
        // rather than letting the picker silently drop it.
        const hex = withHash(e.color);
        const alpha = hex.slice(7);
        return (
          <div key={e.value} className="flex items-center gap-1">
            {/* The swatch is the picker - no edit mode to enter first. */}
            <input
              type="color"
              value={hex.slice(0, 7)}
              data-testid="custom-map-legend-color"
              onChange={(ev) => setColor(e.value, ev.target.value + alpha)}
              title={`Recolour ${e.label || e.value}`}
              aria-label={`Colour for ${e.label || e.value}`}
              className="h-3 w-3 cursor-pointer rounded-sm border-0 bg-transparent p-0"
            />
            <span>{e.label ?? String(e.value)}</span>
          </div>
        );
      })}
    </>
  );
}

export function CustomMapLegend({ customMaps }: { customMaps: CustomMapOut[] }) {
  const activeCustomMapId = useMapStore((s) => s.activeCustomMapId);
  const showCustomMap = useMapStore((s) => s.showCustomMap);
  const customMapOpacity = useMapStore((s) => s.customMapOpacity);
  const setCustomMapOpacity = useMapStore((s) => s.setCustomMapOpacity);
  const overrides = usePreferencesStore((s) => s.customMapOverrides);
  const setCustomMapOverride = usePreferencesStore((s) => s.setCustomMapOverride);
  const resetCustomMapOverride = usePreferencesStore((s) => s.resetCustomMapOverride);

  const cm = customMaps.find((m) => m.id === activeCustomMapId && m.status === 'ready');
  if (!cm || !showCustomMap) return null;

  const override = overrides[cm.id];
  const config = effectiveRenderConfig(cm.render_config, override);
  const customized = isCustomized(cm.render_config, override);
  const onChange = (patch: RenderOverride) => setCustomMapOverride(cm.id, patch);
  const Body = config.mode === 'continuous' ? ContinuousBody : CategoricalBody;

  return (
    <div
      className="absolute bottom-2 right-2 rounded bg-white/90 p-2 text-xs shadow"
      data-testid="custom-map-legend"
      data-customized={customized}
    >
      <div className="max-h-48 overflow-y-auto pr-1">
        <Body config={config} onChange={onChange} />
      </div>

      {customized && (
        <button
          type="button"
          onClick={() => resetCustomMapOverride(cm.id)}
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
        value={customMapOpacity}
        data-testid="custom-map-opacity"
        onChange={(e) => setCustomMapOpacity(Number(e.target.value))}
        title="Overlay opacity"
        className="mt-1.5 block w-28 cursor-pointer accent-brand-500"
      />
    </div>
  );
}
