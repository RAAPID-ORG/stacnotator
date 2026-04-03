import type { VizParams } from './types';

interface VizParamsInlineEditorProps {
  vizParams: VizParams;
  onChange: (key: string, value: unknown) => void;
  showCompositing?: boolean;
  collectionId?: string;
}

/**
 * Compact inline editor for VizParams. Used in CollectionEditor for editing
 * stac_browser collection visualization params and cover visualization overrides.
 * Provides the same fields as VizConfigPanel but in a compact 2-column grid layout.
 */
export const VizParamsInlineEditor = ({
  vizParams,
  onChange,
  showCompositing = true,
  collectionId = '',
}: VizParamsInlineEditorProps) => {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <label className="text-[11px] text-neutral-500">Assets</label>
          <input
            type="text"
            value={vizParams.assets.join(', ')}
            onChange={(e) =>
              onChange(
                'assets',
                e.target.value
                  .split(',')
                  .map((a) => a.trim())
                  .filter(Boolean)
              )
            }
            placeholder="e.g. B04, B03, B02"
            className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs font-mono"
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[11px] text-neutral-500">Rescale</label>
          <input
            type="text"
            value={vizParams.rescale ?? ''}
            onChange={(e) => onChange('rescale', e.target.value || undefined)}
            placeholder="e.g. 0,3000"
            className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs font-mono"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <label className="text-[11px] text-neutral-500">Colormap</label>
          <input
            type="text"
            value={vizParams.colormapName ?? ''}
            onChange={(e) => onChange('colormapName', e.target.value || undefined)}
            placeholder="e.g. viridis"
            className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs"
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[11px] text-neutral-500">Color Formula</label>
          <input
            type="text"
            value={vizParams.colorFormula ?? ''}
            onChange={(e) => onChange('colorFormula', e.target.value || undefined)}
            placeholder="e.g. Gamma RGB 3.2"
            className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <label className="text-[11px] text-neutral-500">Expression</label>
          <input
            type="text"
            value={vizParams.expression ?? ''}
            onChange={(e) => onChange('expression', e.target.value || undefined)}
            placeholder="e.g. (B08-B04)/(B08+B04)"
            className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs font-mono"
          />
        </div>
        {showCompositing && (
          <div className="space-y-0.5">
            <label className="text-[11px] text-neutral-500">Compositing</label>
            <select
              value={vizParams.compositing ?? 'first'}
              onChange={(e) =>
                onChange('compositing', e.target.value === 'first' ? undefined : e.target.value)
              }
              className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs bg-transparent"
            >
              <option value="first">First valid pixel</option>
              <option value="mean">Mean</option>
              <option value="median">Median</option>
              <option value="max">Maximum</option>
              <option value="min">Minimum</option>
              {collectionId.includes('sentinel-2') && (
                <option value="ndvi_best">Best NDVI pixel</option>
              )}
            </select>
            {vizParams.compositing && vizParams.compositing !== 'first' && (
              <p className="text-[10px] text-amber-600 mt-0.5">
                Mean, median, max, min, and NDVI best are experimental and slower.
              </p>
            )}
          </div>
        )}
      </div>
      <div className="space-y-0.5">
        <label className="text-[11px] text-neutral-500">Resampling</label>
        <select
          value={vizParams.resampling ?? ''}
          onChange={(e) => onChange('resampling', e.target.value || undefined)}
          className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs bg-transparent"
        >
          <option value="">Default (nearest)</option>
          <option value="bilinear">Bilinear</option>
          <option value="cubic">Cubic</option>
          <option value="lanczos">Lanczos</option>
          <option value="average">Average</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <label className="text-[11px] text-neutral-500">Mask Layer</label>
          <input
            type="text"
            value={vizParams.maskLayer ?? ''}
            onChange={(e) => onChange('maskLayer', e.target.value || undefined)}
            placeholder="e.g. SCL"
            className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs font-mono"
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[11px] text-neutral-500">Mask Values (exclude)</label>
          <input
            type="text"
            value={vizParams.maskValues?.join(', ') ?? ''}
            onChange={(e) =>
              onChange(
                'maskValues',
                e.target.value
                  ? e.target.value
                      .split(',')
                      .map((v) => parseInt(v.trim(), 10))
                      .filter((v) => !isNaN(v))
                  : undefined
              )
            }
            placeholder="e.g. 0, 1, 8, 9, 10"
            className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs font-mono"
          />
        </div>
      </div>
      <div className="space-y-0.5">
        <label className="text-[11px] text-neutral-500">Max items per tile (1-10)</label>
        <input
          type="number"
          min={1}
          max={10}
          value={vizParams.maxItems ?? 5}
          onChange={(e) => {
            const v = Math.max(1, Math.min(10, Number(e.target.value)));
            onChange('maxItems', v === 5 ? undefined : v);
          }}
          className="w-20 border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs"
        />
      </div>
      <div className="space-y-0.5">
        <label className="text-[11px] text-neutral-500">Extra Tile Parameters</label>
        <input
          type="text"
          value={
            vizParams.extraParams
              ? Object.entries(vizParams.extraParams)
                  .map(([k, v]) => `${k}=${v}`)
                  .join('&')
              : ''
          }
          onChange={(e) => {
            const val = e.target.value.trim();
            if (!val) {
              onChange('extraParams', undefined);
              return;
            }
            const params: Record<string, string> = {};
            for (const pair of val.split('&')) {
              const [k, ...rest] = pair.split('=');
              if (k) params[k.trim()] = rest.join('=').trim();
            }
            onChange('extraParams', Object.keys(params).length > 0 ? params : undefined);
          }}
          placeholder="e.g. asset_bidx=image|1,2,3"
          className="w-full border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs font-mono"
        />
      </div>
    </div>
  );
};
