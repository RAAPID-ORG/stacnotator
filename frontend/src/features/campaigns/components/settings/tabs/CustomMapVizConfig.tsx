import { useMemo, useState } from 'react';
import { COLORMAPS } from '~/features/campaigns/components/imagery/collectionPresets';
import {
  normalizeColorFormula,
  validateColorFormula,
  validateRescale,
} from '~/features/campaigns/components/imagery/vizValidation';
import { inputClass } from '~/shared/ui/forms';
import type { CustomMap, CustomMapVizParams } from '~/api/customMaps';

interface Props {
  customMap: CustomMap;
  onChange: (vizParams: CustomMapVizParams) => void;
}

type RescaleMode = 'manual' | 'none';

function modeFor(rescale: string | undefined): RescaleMode {
  return rescale === '' ? 'none' : 'manual';
}

export function CustomMapVizConfig({ customMap, onChange }: Props) {
  const params = customMap.viz_params ?? {};
  const defaultRescale =
    customMap.min_value != null && customMap.max_value != null
      ? `${customMap.min_value},${customMap.max_value}`
      : '';
  const [rescaleMode, setRescaleMode] = useState<RescaleMode>(modeFor(params.rescale));

  const patch = (delta: Partial<CustomMapVizParams>) => onChange({ ...params, ...delta });

  const rescaleError = useMemo(() => validateRescale(params.rescale ?? ''), [params.rescale]);
  const colorFormulaError = useMemo(
    () => validateColorFormula(params.color_formula ?? ''),
    [params.color_formula]
  );

  return (
    <div className="space-y-3 p-3 border border-neutral-200 rounded-md bg-neutral-50">
      <div className="space-y-1">
        <label className="text-xs text-neutral-700 font-medium">Colormap</label>
        <select
          value={params.colormap_name ?? 'viridis'}
          onChange={(e) => patch({ colormap_name: e.target.value })}
          className={`${inputClass} w-full text-xs`}
        >
          {COLORMAPS.map((cm) => (
            <option key={cm.value} value={cm.value}>
              {cm.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-neutral-700 font-medium">Rescale</label>
        <div className="flex gap-1.5">
          {(['manual', 'none'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setRescaleMode(mode);
                patch({ rescale: mode === 'manual' ? defaultRescale : '' });
              }}
              className={`flex-1 text-xs px-2 py-1.5 rounded-md border transition-colors cursor-pointer ${
                rescaleMode === mode
                  ? 'border-brand-600 bg-brand-50 text-brand-700 font-medium'
                  : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
              }`}
            >
              {mode === 'manual' ? 'Manual' : 'None'}
            </button>
          ))}
        </div>
        {rescaleMode === 'manual' && (
          <>
            <input
              type="text"
              value={params.rescale ?? defaultRescale}
              onChange={(e) => patch({ rescale: e.target.value })}
              placeholder={defaultRescale || 'min,max'}
              className={`${inputClass} w-full text-xs font-mono ${
                rescaleError ? 'border-red-400 focus:border-red-500' : ''
              }`}
            />
            {rescaleError ? (
              <p className="text-[11px] text-red-600">{rescaleError}</p>
            ) : defaultRescale ? (
              <p className="text-[11px] text-neutral-400">
                Pre-filled from raster stats (min={customMap.min_value}, max=
                {customMap.max_value}).
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs text-neutral-700 font-medium">Color formula (optional)</label>
        <input
          type="text"
          value={params.color_formula ?? ''}
          onChange={(e) => patch({ color_formula: e.target.value || undefined })}
          onBlur={(e) => {
            const fixed = normalizeColorFormula(e.target.value);
            if (fixed !== e.target.value) patch({ color_formula: fixed || undefined });
          }}
          placeholder="e.g. gamma rgb 1.3, saturation 1.2"
          className={`${inputClass} w-full text-[11px] font-mono ${
            colorFormulaError ? 'border-red-400 focus:border-red-500' : ''
          }`}
        />
        {colorFormulaError && <p className="text-[11px] text-red-600">{colorFormulaError}</p>}
      </div>

      <div className="space-y-1">
        <label className="text-xs text-neutral-700 font-medium">Expression (optional)</label>
        <input
          type="text"
          value={params.expression ?? ''}
          onChange={(e) => patch({ expression: e.target.value || undefined })}
          placeholder="e.g. b1*2.5"
          className={`${inputClass} w-full text-[11px] font-mono`}
        />
      </div>
    </div>
  );
}
