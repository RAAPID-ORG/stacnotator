import { describe, expect, it } from 'vitest';
import { validateColorFormula } from '~/features/layers/imagery/vizValidation';
import { parseColorFormula, withColorAdjust } from './colorAdjust';

// How MPC's Sentinel-2 render config writes it: no commas, capitalised op names.
const SENTINEL_2 = 'Gamma RGB 3.2 Saturation 0.8 Sigmoidal RGB 25 0.35';

describe('a color formula read the way rio-color reads it', () => {
  it('accepts operations separated by spaces alone', () => {
    expect(validateColorFormula(SENTINEL_2)).toBeNull();
    expect(parseColorFormula(SENTINEL_2)).toEqual({
      gamma: 3.2,
      contrast: 25,
      midpoint: 0.35,
      saturation: 0.8,
    });
  });

  it('moves a slider in place and keeps the operations no slider shows', () => {
    const formula = 'gamma R 1.1, gamma RGB 2, sigmoidal RGB 10 0.5';
    const adjust = { ...parseColorFormula(formula), gamma: 1.5, contrast: 0 };
    expect(withColorAdjust(formula, adjust)).toBe('gamma R 1.1, gamma RGB 1.5');
  });

  it('adds what a slider sets and drops the formula once every slider is at rest', () => {
    const turned = withColorAdjust(SENTINEL_2, { ...parseColorFormula(SENTINEL_2), gamma: 2 });
    expect(turned).toBe('gamma RGB 2, saturation 0.8, sigmoidal RGB 25 0.35');
    expect(
      withColorAdjust(SENTINEL_2, { gamma: 1, contrast: 0, midpoint: 0.5, saturation: 1 })
    ).toBeNull();
    expect(withColorAdjust(null, { gamma: 1, contrast: 0, midpoint: 0.5, saturation: 1.2 })).toBe(
      'saturation 1.2'
    );
  });
});
