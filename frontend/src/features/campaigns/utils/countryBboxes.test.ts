import { describe, expect, it } from 'vitest';
import { COUNTRY_BBOXES } from './countryBboxes';

describe('COUNTRY_BBOXES', () => {
  it('has a unique name per entry', () => {
    const names = COUNTRY_BBOXES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('holds non-empty [west, south, east, north] boxes inside the CRS bounds', () => {
    for (const { name, bbox } of COUNTRY_BBOXES) {
      const [west, south, east, north] = bbox;
      expect(west, name).toBeGreaterThanOrEqual(-180);
      expect(east, name).toBeLessThanOrEqual(180);
      expect(south, name).toBeGreaterThanOrEqual(-90);
      expect(north, name).toBeLessThanOrEqual(90);
      expect(west, name).toBeLessThan(east);
      expect(south, name).toBeLessThan(north);
    }
  });
});
