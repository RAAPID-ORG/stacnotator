import { describe, expect, it } from 'vitest';
import { expressionAssets } from './expressionAssets';

describe('expressionAssets', () => {
  it('reads every asset an expression names, skipping functions and numbers', () => {
    expect(expressionAssets('where(nir08>0,(nir08-red)/(nir08+red),0)*1.5')).toEqual({
      assets: ['nir08', 'red'],
      assetAsBand: true,
    });
  });

  it('reads band references as bands of their asset', () => {
    expect(expressionAssets('(data_b4-data_b3)/(data_b4+data_b3)')).toEqual({
      assets: ['data'],
      assetAsBand: false,
    });
  });
});
