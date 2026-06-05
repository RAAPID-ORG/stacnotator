import { describe, it, expect } from 'vitest';
import { savitzkyGolay } from '../components/TimeSeries/savitzkyGolay';

const TOLERANCE = 1e-6;

function approxEqual(a: number, b: number, tol = TOLERANCE): boolean {
  return Math.abs(a - b) < tol;
}

function variance(data: (number | null)[]): number {
  const vals = data.filter((v): v is number => v !== null);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  return vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
}

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('returns empty array for empty input', () => {
    expect(savitzkyGolay([], 5, 2)).toEqual([]);
  });

  it('returns original when fewer points than window size', () => {
    const data = [0.1, 0.2, 0.3, 0.4];
    expect(savitzkyGolay(data, 5, 2)).toEqual(data);
  });

  it('filter runs when length exactly equals window size', () => {
    // n < windowSize returns original; n === windowSize applies the filter
    const data = [1, 2, 3, 4, 5];
    const result = savitzkyGolay(data, 5, 2);
    expect(result).toHaveLength(5);
    result.forEach((v) => expect(typeof v).toBe('number'));
  });

  it('returns all-null array unchanged', () => {
    const data: (number | null)[] = [null, null, null, null, null, null, null, null];
    expect(savitzkyGolay(data, 5, 2)).toEqual(data);
  });

  it('output has the same length as input', () => {
    const data = Array.from({ length: 20 }, (_, i) => i * 0.05);
    const result = savitzkyGolay(data, 7, 3);
    expect(result).toHaveLength(data.length);
  });
});

// ---------------------------------------------------------------------------
// Parameter clamping
// ---------------------------------------------------------------------------

describe('parameter clamping', () => {
  it('window size below 5 is clamped to 5', () => {
    const constant = Array.from({ length: 20 }, () => 0.5);
    const withSmallWindow = savitzkyGolay(constant, 3, 1);
    expect(withSmallWindow).toHaveLength(20);
    withSmallWindow.forEach((v) => expect(v).not.toBeNull());
  });

  it('even window size is bumped to next odd number', () => {
    const data = Array.from({ length: 20 }, (_, i) => i * 0.1);
    const withEven = savitzkyGolay(data, 6, 2);
    const withOdd = savitzkyGolay(data, 7, 2);
    // Both should produce valid output of correct length
    expect(withEven).toHaveLength(20);
    expect(withOdd).toHaveLength(20);
    // Even window=6 behaves the same as odd window=7 (internally bumped)
    withEven.forEach((v, i) => {
      expect(v).not.toBeNull();
      if (withOdd[i] !== null && v !== null) {
        expect(Math.abs(v - withOdd[i]!)).toBeLessThan(TOLERANCE);
      }
    });
  });

  it('poly order >= windowSize is clamped to windowSize - 1', () => {
    const data = Array.from({ length: 20 }, (_, i) => Math.sin(i * 0.5));
    const result = savitzkyGolay(data, 5, 10);
    expect(result).toHaveLength(20);
    result.forEach((v) => expect(v).not.toBeNull());
  });
});

// ---------------------------------------------------------------------------
// Null preservation
// ---------------------------------------------------------------------------

describe('null preservation', () => {
  const baseData: (number | null)[] = [
    0.3, 0.4, 0.5, 0.6, 0.55, 0.45, 0.35, 0.5, 0.6, 0.7, 0.65, 0.55, 0.45, 0.5, 0.6, 0.7, 0.65,
    0.55, 0.5, 0.4,
  ];

  it('nulls at arbitrary positions are preserved', () => {
    const data = [...baseData];
    data[2] = null;
    data[7] = null;
    data[14] = null;
    const result = savitzkyGolay(data, 5, 2);
    expect(result[2]).toBeNull();
    expect(result[7]).toBeNull();
    expect(result[14]).toBeNull();
  });

  it('leading nulls are preserved', () => {
    const data: (number | null)[] = [null, null, null, ...baseData.slice(3)];
    const result = savitzkyGolay(data, 5, 2);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeNull();
  });

  it('trailing nulls are preserved', () => {
    const data: (number | null)[] = [...baseData.slice(0, -3), null, null, null];
    const result = savitzkyGolay(data, 5, 2);
    expect(result[result.length - 1]).toBeNull();
    expect(result[result.length - 2]).toBeNull();
    expect(result[result.length - 3]).toBeNull();
  });

  it('null positions contain no smoothed values, non-null positions always produce numbers', () => {
    const data = [...baseData];
    data[4] = null;
    data[10] = null;
    const result = savitzkyGolay(data, 5, 2);
    result.forEach((v, i) => {
      if (data[i] === null) {
        expect(v).toBeNull();
      } else {
        expect(typeof v).toBe('number');
        expect(isNaN(v as number)).toBe(false);
      }
    });
  });

  it('consecutive null gap is preserved, neighbouring values still smoothed', () => {
    const data: (number | null)[] = [
      0.3,
      0.4,
      0.5,
      null,
      null,
      null,
      0.5,
      0.6,
      0.7,
      0.65,
      0.55,
      0.45,
      0.5,
      0.6,
      0.7,
      0.65,
      0.55,
      0.5,
      0.4,
      0.3,
    ];
    const result = savitzkyGolay(data, 5, 2);
    expect(result[3]).toBeNull();
    expect(result[4]).toBeNull();
    expect(result[5]).toBeNull();
    expect(typeof result[0]).toBe('number');
    expect(typeof result[6]).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Mathematical properties
// ---------------------------------------------------------------------------

describe('mathematical properties', () => {
  it('constant input is preserved exactly', () => {
    const data = Array.from({ length: 20 }, () => 0.5);
    const result = savitzkyGolay(data, 7, 3);
    result.forEach((v) => {
      expect(v).not.toBeNull();
      expect(approxEqual(v as number, 0.5, 1e-9)).toBe(true);
    });
  });

  it('zero-valued constant input is preserved', () => {
    const data = Array.from({ length: 20 }, () => 0);
    const result = savitzkyGolay(data, 5, 2);
    result.forEach((v) => expect(approxEqual(v as number, 0, 1e-9)).toBe(true));
  });

  it('linear input is preserved (SG preserves polynomials up to poly_order)', () => {
    // Poly order 1 should preserve linear trends (within edge-effect tolerance)
    const data = Array.from({ length: 20 }, (_, i) => 0.1 + i * 0.02);
    const result = savitzkyGolay(data, 5, 1);
    // Interior points should be close to the linear trend
    for (let i = 3; i < 17; i++) {
      expect(approxEqual(result[i] as number, data[i], 0.01)).toBe(true);
    }
  });

  it('higher poly order preserves higher-degree polynomial trends', () => {
    // Poly order 2 should fit a quadratic exactly (no smoothing = exact reproduction)
    const data = Array.from({ length: 20 }, (_, i) => 0.01 * i * i);
    const result = savitzkyGolay(data, 5, 2);
    for (let i = 3; i < 17; i++) {
      expect(approxEqual(result[i] as number, data[i], 0.02)).toBe(true);
    }
  });

  it('smoothing reduces variance of noisy data', () => {
    // Deliberately noisy signal: sine wave with high-frequency noise
    const data = Array.from({ length: 50 }, (_, i) => {
      const signal = 0.5 + 0.2 * Math.sin(i * 0.3);
      const noise = 0.15 * (((i * 7919 + 31337) % 100) / 100 - 0.5); // deterministic noise
      return signal + noise;
    });
    const smoothed = savitzkyGolay(data, 11, 3);
    expect(variance(smoothed)).toBeLessThan(variance(data));
  });

  it('smoothed values stay within the range of the input', () => {
    const data = Array.from({ length: 30 }, (_, i) => 0.3 + 0.4 * Math.abs(Math.sin(i * 0.4)));
    const min = Math.min(...data);
    const max = Math.max(...data);
    const result = savitzkyGolay(data, 7, 3);
    result.forEach((v) => {
      expect(v as number).toBeGreaterThanOrEqual(min - 0.05);
      expect(v as number).toBeLessThanOrEqual(max + 0.05);
    });
  });
});

// ---------------------------------------------------------------------------
// Typical NDVI time series
// ---------------------------------------------------------------------------

describe('typical NDVI time series', () => {
  // Represents a realistic Sentinel-2 NDVI series over one growing season.
  // Values increase through spring, peak in summer, decline in autumn.
  const ndviSeries: (number | null)[] = [
    0.12,
    0.15,
    null,
    0.18,
    0.22,
    0.25,
    null,
    null,
    0.35,
    0.42,
    0.51,
    0.58,
    0.65,
    null,
    0.7,
    0.73,
    0.71,
    0.68,
    null,
    0.62,
    0.55,
    0.48,
    0.4,
    0.32,
    null,
    0.25,
    0.2,
    0.16,
    0.13,
    0.11,
  ];

  it('produces output of same length', () => {
    expect(savitzkyGolay(ndviSeries, 7, 3)).toHaveLength(ndviSeries.length);
  });

  it('preserves all null positions in NDVI series', () => {
    const result = savitzkyGolay(ndviSeries, 7, 3);
    ndviSeries.forEach((v, i) => {
      if (v === null) expect(result[i]).toBeNull();
    });
  });

  it('all non-null outputs are valid numbers in plausible NDVI range', () => {
    const result = savitzkyGolay(ndviSeries, 7, 3);
    result.forEach((v, i) => {
      if (ndviSeries[i] !== null) {
        expect(typeof v).toBe('number');
        expect(isNaN(v as number)).toBe(false);
        expect(v as number).toBeGreaterThan(-0.2);
        expect(v as number).toBeLessThan(1.1);
      }
    });
  });

  it('smoothing removes the sawtooth pattern while preserving seasonal trend', () => {
    // Artificially noisy NDVI: same season shape but with alternating ±0.05 noise
    const noisy = ndviSeries.map((v, i) => (v === null ? null : v + (i % 2 === 0 ? 0.05 : -0.05)));
    const smoothed = savitzkyGolay(noisy, 7, 3);
    const noisyVar = variance(noisy);
    const smoothVar = variance(smoothed);
    expect(smoothVar).toBeLessThan(noisyVar);
  });

  it('larger window produces smoother output (lower variance) than smaller window', () => {
    const noisy = ndviSeries.map((v) => (v === null ? null : v + (Math.random() - 0.5) * 0.1));
    const narrow = savitzkyGolay(noisy, 5, 2);
    const wide = savitzkyGolay(noisy, 11, 3);
    expect(variance(wide)).toBeLessThan(variance(narrow));
  });

  it('window=5 poly=2: specific interior values are smoothed (closer to local mean)', () => {
    // Use a clean NDVI-like series where expected smoothed values can be verified
    const clean: (number | null)[] = [
      0.2, 0.3, 0.5, 0.4, 0.6, 0.5, 0.7, 0.6, 0.5, 0.4, 0.5, 0.6, 0.7, 0.6, 0.5,
    ];
    const result = savitzkyGolay(clean, 5, 2);
    // Non-null outputs should exist
    result.forEach((v) => expect(v).not.toBeNull());
    // Interior values should be close to a 5-point local average (within 0.15)
    for (let i = 2; i < clean.length - 2; i++) {
      const localMean =
        ((clean[i - 2] as number) +
          (clean[i - 1] as number) +
          (clean[i] as number) +
          (clean[i + 1] as number) +
          (clean[i + 2] as number)) /
        5;
      expect(Math.abs((result[i] as number) - localMean)).toBeLessThan(0.15);
    }
  });
});
