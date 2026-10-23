import { describe, expect, it } from 'vitest';
import { labelColumnCount, labelColumnWidth } from './labelColumns';

const BOX = { gap: 6, inset: 25 };

describe('labelColumnCount', () => {
  it('keeps one column until a second chip fits beside the other controls', () => {
    // 25 inset + 160 + 6 + 160 + 256 for the right column
    expect(labelColumnCount(606, 160, 11, BOX)).toBe(1);
    expect(labelColumnCount(607, 160, 11, BOX)).toBe(2);
  });

  it('breaks into more columns sooner when the chips are narrower', () => {
    expect(labelColumnCount(800, 160, 11, BOX)).toBe(3);
    expect(labelColumnCount(800, 100, 11, BOX)).toBe(4);
  });

  it('never exceeds the number of labels, nor drops below one', () => {
    expect(labelColumnCount(4000, 160, 3, BOX)).toBe(3);
    expect(labelColumnCount(100, 160, 3, BOX)).toBe(1);
  });
});

describe('labelColumnWidth', () => {
  it('fits the chips and the gaps between them exactly', () => {
    expect(labelColumnWidth(1, 160, BOX)).toBe(185);
    expect(labelColumnWidth(2, 160, BOX)).toBe(351);
  });
});
