import { describe, it, expect } from 'vitest';
import type { CampaignOutFull } from '~/api/client';
import { extendedLabels, labelsWithSameGeometry } from './labels';

function campaignWithLabels(
  labels: CampaignOutFull['settings']['labels']
): Pick<CampaignOutFull, 'settings'> {
  return { settings: { labels } as CampaignOutFull['settings'] };
}

describe('extendedLabels', () => {
  it('defaults a missing geometry_type to polygon', () => {
    const [label] = extendedLabels(campaignWithLabels([{ id: 1, name: 'Tree' }]));
    expect(label.geometry_type).toBe('polygon');
  });

  it('keeps an explicit geometry_type', () => {
    const [label] = extendedLabels(
      campaignWithLabels([{ id: 1, name: 'Tree', geometry_type: 'point' }])
    );
    expect(label.geometry_type).toBe('point');
  });

  it('assigns colors from the palette by list position, cycling on overflow', () => {
    const labels = Array.from({ length: 11 }, (_, i) => ({ id: i, name: `L${i}` }));
    const result = extendedLabels(campaignWithLabels(labels));
    expect(result[0].color).toBe(result[10].color);
    expect(result[0].color).not.toBe(result[1].color);
  });

  it('returns an empty array for a missing campaign or missing labels', () => {
    expect(extendedLabels(null)).toEqual([]);
    expect(extendedLabels(undefined)).toEqual([]);
  });
});

const LABELS = extendedLabels(
  campaignWithLabels([
    { id: 1, name: 'Tree', geometry_type: 'point' },
    { id: 2, name: 'Field', geometry_type: 'polygon' },
    { id: 3, name: 'Road', geometry_type: 'line' },
    { id: 4, name: 'Lake', geometry_type: 'polygon' },
  ])
);

describe('labelsWithSameGeometry', () => {
  it('keeps only labels whose geometry matches the given label', () => {
    const result = labelsWithSameGeometry(LABELS, 2);
    expect(result.map((l) => l.id)).toEqual([2, 4]);
  });

  it('returns the sole matching label when nothing else shares its geometry', () => {
    expect(labelsWithSameGeometry(LABELS, 1).map((l) => l.id)).toEqual([1]);
  });

  it('falls back to the full list for an unknown or null label id', () => {
    expect(labelsWithSameGeometry(LABELS, 999).map((l) => l.id)).toEqual([1, 2, 3, 4]);
    expect(labelsWithSameGeometry(LABELS, null).map((l) => l.id)).toEqual([1, 2, 3, 4]);
  });
});
