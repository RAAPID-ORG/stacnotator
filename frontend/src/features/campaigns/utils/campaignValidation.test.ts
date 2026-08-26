import { describe, expect, it } from 'vitest';
import type { CampaignCreate } from '~/api/client';
import { validateSettingsStep } from './campaignValidation';

const form = (bbox: Partial<Record<string, number>>): CampaignCreate =>
  ({
    name: 'c',
    settings: {
      labels: [{ name: 'a', geometry_type: 'polygon' }],
      bbox_west: -176.5,
      bbox_south: 65.3,
      bbox_east: -170,
      bbox_north: 67.7,
      ...bbox,
    },
  }) as unknown as CampaignCreate;

describe('the campaign area', () => {
  it('accepts an ordinary box', () => {
    expect(validateSettingsStep(form({})).isValid).toBe(true);
  });

  // The one that got through: west < east held, so only the range check catches
  // it, and without that the insert failed on the table's CHECK as a 500.
  it('rejects a longitude the map wrapped past the antimeridian', () => {
    const { errors, isValid } = validateSettingsStep(form({ bbox_west: -196.17 }));
    expect(isValid).toBe(false);
    expect(errors.bbox).toMatch(/between -180 and 180/);
  });

  it('rejects a latitude past the pole', () => {
    expect(validateSettingsStep(form({ bbox_north: 95 })).isValid).toBe(false);
  });

  it('explains that an area may not straddle 180', () => {
    const { errors } = validateSettingsStep(form({ bbox_west: 163.8, bbox_east: -176.5 }));
    expect(errors.bbox).toMatch(/antimeridian/);
  });

  it('still catches an inverted latitude range', () => {
    const { errors } = validateSettingsStep(form({ bbox_south: 70, bbox_north: 65 }));
    expect(errors.bbox).toMatch(/South latitude/);
  });
});
