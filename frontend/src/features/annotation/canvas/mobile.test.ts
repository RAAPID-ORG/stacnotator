import { describe, it, expect } from 'vitest';
import { mobileStack, type LayoutItem } from './grid';

describe('mobileStack', () => {
  it('stacks main and controls sharing the viewport, then groups, minimap, then windows', () => {
    const windows: Record<number, LayoutItem> = {
      102: { i: '102', x: 0, y: 0, w: 10, h: 9 },
      101: { i: '101', x: 0, y: 0, w: 10, h: 9 },
    };
    const items = mobileStack(windows, ['timeseries:Time series'], 600);

    expect(items.map((it) => it.i)).toEqual([
      'main',
      'controls',
      'timeseries:Time series',
      'minimap',
      '101',
      '102',
    ]);
  });

  it('gives main and controls each half the viewport height in rows, minimum 20', () => {
    const items = mobileStack({}, [], 600);
    const main = items.find((it) => it.i === 'main')!;
    const controls = items.find((it) => it.i === 'controls')!;
    expect(main).toEqual({ i: 'main', x: 0, y: 0, w: 60, h: 20 });
    expect(controls).toEqual({ i: 'controls', x: 0, y: 20, w: 60, h: 20 });
  });

  it('every stacked item spans the full 60-column width', () => {
    const items = mobileStack({ 1: { i: '1', x: 0, y: 0, w: 10, h: 9 } }, ['timeseries:A'], 900);
    expect(items.every((it) => it.w === 60)).toBe(true);
  });
});
