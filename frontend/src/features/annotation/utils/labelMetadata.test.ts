import { describe, it, expect } from 'vitest';
import { extendLabelsWithMetadata, labelsWithSameGeometry } from './labelMetadata';

const LABELS = extendLabelsWithMetadata([
  { id: 1, name: 'Tree', geometry_type: 'point' },
  { id: 2, name: 'Field', geometry_type: 'polygon' },
  { id: 3, name: 'Road', geometry_type: 'line' },
  { id: 4, name: 'Lake', geometry_type: 'polygon' },
]);

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
