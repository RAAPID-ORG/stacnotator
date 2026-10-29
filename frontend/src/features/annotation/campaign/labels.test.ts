import { describe, it, expect } from 'vitest';
import type { CampaignOutFull } from '~/api/client';
import { extendedLabels, labelsForGeometry } from './annotation';

function campaignWithLabels(
  labels: CampaignOutFull['settings']['labels']
): Pick<CampaignOutFull, 'settings'> {
  return { settings: { labels } as CampaignOutFull['settings'] };
}

describe('extendedLabels', () => {
  it('keeps an explicit geometry_type', () => {
    const [label] = extendedLabels(
      campaignWithLabels([{ id: 1, name: 'Tree', geometry_type: 'point' }])
    );
    expect(label.geometry_type).toBe('point');
  });

  it('assigns colors from the palette by list position, cycling on overflow', () => {
    const labels = Array.from({ length: 11 }, (_, i) => ({
      id: i,
      name: `L${i}`,
      geometry_type: 'polygon' as const,
    }));
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

describe('labelsForGeometry', () => {
  it('keeps only labels of the shape type, whatever label it carries now', () => {
    const point: GeoJSON.Point = { type: 'Point', coordinates: [1, 2] };
    expect(labelsForGeometry(LABELS, point).map((l) => l.id)).toEqual([1]);
  });

  it('treats a multi geometry as its single type', () => {
    const multi: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: [] };
    expect(labelsForGeometry(LABELS, multi).map((l) => l.id)).toEqual([2, 4]);
  });
});
