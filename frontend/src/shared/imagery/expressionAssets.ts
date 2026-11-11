const FUNCTIONS = new Set([
  'where',
  'sqrt',
  'abs',
  'log',
  'log10',
  'log1p',
  'exp',
  'expm1',
  'sin',
  'cos',
  'tan',
  'arcsin',
  'arccos',
  'arctan',
  'arctan2',
  'sinh',
  'cosh',
  'tanh',
  'arcsinh',
  'arccosh',
  'arctanh',
  'floor',
  'ceil',
  'minimum',
  'maximum',
  'real',
  'imag',
  'complex',
  'conj',
  'contains',
  'True',
  'False',
]);

/**
 * The assets a titiler band expression reads, and whether it names them directly
 * (`asset_as_band`) or by band (`B04_b1`, `data_b2`).
 */
export function expressionAssets(expression: string): { assets: string[]; assetAsBand: boolean } {
  const names = [
    ...new Set(
      (expression.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).filter((name) => !FUNCTIONS.has(name))
    ),
  ];
  const byBand = names.length > 0 && names.every((name) => /_b\d+$/.test(name));
  return {
    assets: byBand ? [...new Set(names.map((name) => name.replace(/_b\d+$/, '')))] : names,
    assetAsBand: !byBand,
  };
}
