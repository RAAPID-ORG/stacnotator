import type { VizParams } from './types';

export interface VizParamsFieldEntry {
  feKey: keyof VizParams;
  apiKey: string;
  /** Default used on the read path when the API value is null/missing. */
  readDefault: unknown;
  /** Write-path normalizer. When absent, the field value is passed through as-is. */
  toApi?: (v: VizParams) => unknown;
}

export const VIZ_PARAMS_FIELD_MAP: VizParamsFieldEntry[] = [
  { feKey: 'assets', apiKey: 'assets', readDefault: [] },
  { feKey: 'assetAsBand', apiKey: 'asset_as_band', readDefault: false },
  {
    feKey: 'bidx',
    apiKey: 'bidx',
    readDefault: undefined,
    toApi: (v) => (v.bidx?.length ? v.bidx : undefined),
  },
  {
    feKey: 'rescale',
    apiKey: 'rescale',
    readDefault: '',
    toApi: (v) => v.rescale || undefined,
  },
  { feKey: 'colormapName', apiKey: 'colormap_name', readDefault: undefined },
  { feKey: 'colorFormula', apiKey: 'color_formula', readDefault: undefined },
  { feKey: 'expression', apiKey: 'expression', readDefault: undefined },
  { feKey: 'resampling', apiKey: 'resampling', readDefault: undefined },
  { feKey: 'compositing', apiKey: 'compositing', readDefault: undefined },
  { feKey: 'nodata', apiKey: 'nodata', readDefault: undefined },
  { feKey: 'extraParams', apiKey: 'extra_params', readDefault: undefined },
  { feKey: 'maskLayer', apiKey: 'mask_layer', readDefault: undefined },
  { feKey: 'maskValues', apiKey: 'mask_values', readDefault: undefined },
  { feKey: 'nirBand', apiKey: 'nir_band', readDefault: undefined },
  { feKey: 'redBand', apiKey: 'red_band', readDefault: undefined },
  { feKey: 'maxItems', apiKey: 'max_items', readDefault: undefined },
];
