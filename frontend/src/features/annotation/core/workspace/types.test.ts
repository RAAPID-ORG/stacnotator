import { describe, it, expect } from 'vitest';
import { fromGridLayout, toGridLayout, type WorkspaceLayout } from './types';

const sampleLayout = (): WorkspaceLayout => ({
  main: {
    main: { i: 'main', x: 0, y: 0, w: 60, h: 20 },
    minimap: { i: 'minimap', x: 0, y: 20, w: 20, h: 10 },
    controls: { i: 'controls', x: 40, y: 0, w: 20, h: 20 },
    timeseries: {
      'timeseries:Time series': { i: 'timeseries:Time series', x: 0, y: 30, w: 60, h: 15 },
    },
  },
  view: {
    windows: {
      101: { i: '101', x: 0, y: 45, w: 10, h: 9 },
      102: { i: '102', x: 10, y: 45, w: 10, h: 9 },
    },
  },
});

describe('toGridLayout / fromGridLayout round-trip', () => {
  it('flattens a WorkspaceLayout into a flat grid array', () => {
    const flat = toGridLayout(sampleLayout());
    expect(flat.map((it) => it.i).sort()).toEqual(
      ['101', '102', 'controls', 'main', 'minimap', 'timeseries:Time series'].sort()
    );
  });

  it('rebuilds an equivalent WorkspaceLayout from its flat form', () => {
    const original = sampleLayout();
    const rebuilt = fromGridLayout(toGridLayout(original), original);
    expect(rebuilt).toEqual(original);
  });

  it('falls back to the previous layout for main-chrome slots missing from the flat array', () => {
    const original = sampleLayout();
    const flatWithoutControls = toGridLayout(original).filter((it) => it.i !== 'controls');
    const rebuilt = fromGridLayout(flatWithoutControls, original);
    expect(rebuilt.main.controls).toEqual(original.main.controls);
  });

  it('drops a window that is no longer present in the flat array (e.g. after hideWindow)', () => {
    const original = sampleLayout();
    const withoutWindow101 = toGridLayout(original).filter((it) => it.i !== '101');
    const rebuilt = fromGridLayout(withoutWindow101, original);
    expect(rebuilt.view.windows[101]).toBeUndefined();
    expect(rebuilt.view.windows[102]).toEqual(original.view.windows[102]);
  });
});
