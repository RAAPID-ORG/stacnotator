import { describe, expect, it } from 'vitest';
import type { VisualizerOptionsOut } from '~/api/client';
import { publishConfirm, restrictedSelection } from './publishWarning';

const OPTIONS: VisualizerOptionsOut = {
  campaigns: [
    {
      campaign_id: 42,
      campaign_name: 'Ukraine maize',
      area: null,
      sources: [
        {
          id: 11,
          name: 'Sentinel-2',
          step_count: 12,
          visualizations: ['True Color'],
          start_date: null,
          end_date: null,
          cadences: ['monthly'],
          restriction: null,
        },
        {
          id: 12,
          name: 'Planet NICFI',
          step_count: 12,
          visualizations: ['Visual'],
          start_date: null,
          end_date: null,
          cadences: ['monthly'],
          restriction: 'api_key',
        },
      ],
      raster_overlays: [
        { id: 21, name: 'Yield v3', status: 'ready', restriction: null },
        { id: 22, name: 'Internal yield', status: 'ready', restriction: 'internal_storage' },
      ],
      vector_overlays: [{ id: 31, name: 'Fields', status: 'ready', restriction: null }],
    },
  ],
};

describe('restrictedSelection', () => {
  it('is empty when everything picked is open imagery', () => {
    expect(
      restrictedSelection(OPTIONS, {
        imagery: [{ source_id: 11 }],
        overlays: [{ custom_map_id: 21 }],
      })
    ).toEqual([]);
  });

  it('names the key-proxied source and the internal-storage overlay', () => {
    expect(
      restrictedSelection(OPTIONS, {
        imagery: [{ source_id: 11 }, { source_id: 12 }],
        overlays: [{ custom_map_id: 22 }, { vector_layer_id: 31 }],
      })
    ).toEqual([
      { name: 'Planet NICFI', reason: 'api_key' },
      { name: 'Internal yield', reason: 'internal_storage' },
    ]);
  });
});

describe('publishConfirm', () => {
  it('asks for nothing when nothing is behind a credential', () => {
    expect(publishConfirm([])).toBeNull();
  });

  it('names every layer it would expose', () => {
    const confirm = publishConfirm([
      { name: 'Planet NICFI', reason: 'api_key' },
      { name: 'Internal yield', reason: 'internal_storage' },
    ]);
    expect(confirm?.description).toContain('Planet NICFI, Internal yield');
    expect(confirm?.isDangerous).toBe(true);
  });
});
