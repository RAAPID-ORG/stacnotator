import { describe, it, expect } from 'vitest';
import {
  resolveLabelStyle,
  emphasizedFillOpacity,
  emphasizedStrokeWidth,
  setStyleOverride,
  clearStyleOverride,
  type StyleOverrides,
} from './annotationStyle';

// ---------------------------------------------------------------------------
// resolveLabelStyle - override layered on the label's default color
// ---------------------------------------------------------------------------

describe('resolveLabelStyle', () => {
  it('without an override, reproduces the original hardcoded look', () => {
    expect(resolveLabelStyle('#10b981', 'polygon')).toEqual({
      fillColor: '#10b981',
      fillOpacity: 0.2,
      strokeColor: '#10b981',
      strokeOpacity: 1,
      strokeWidth: 2,
    });
  });

  it('defaults a line to a thicker stroke than a polygon/point', () => {
    expect(resolveLabelStyle('#fff', 'line').strokeWidth).toBe(3);
    expect(resolveLabelStyle('#fff', 'point').strokeWidth).toBe(2);
    expect(resolveLabelStyle('#fff', 'polygon').strokeWidth).toBe(2);
  });

  it('uses both the default color for fill and stroke when only one is set', () => {
    // A user who only recolors the fill keeps the border on the original color
    const s = resolveLabelStyle('#3b82f6', 'polygon', { fillColor: '#ff0000' });
    expect(s.fillColor).toBe('#ff0000');
    expect(s.strokeColor).toBe('#3b82f6');
  });

  it('lets every overridden field win over the default', () => {
    const s = resolveLabelStyle('#10b981', 'line', {
      fillColor: '#111111',
      fillOpacity: 0.5,
      strokeColor: '#222222',
      strokeOpacity: 0.4,
      strokeWidth: 6,
    });
    expect(s).toEqual({
      fillColor: '#111111',
      fillOpacity: 0.5,
      strokeColor: '#222222',
      strokeOpacity: 0.4,
      strokeWidth: 6,
    });
  });

  it('treats a 0 opacity override as set, not as "fall back to default"', () => {
    // Regression guard against `override.fillOpacity || default` style bugs:
    // a fully transparent fill (0) is a deliberate user choice.
    expect(resolveLabelStyle('#10b981', 'polygon', { fillOpacity: 0 }).fillOpacity).toBe(0);
    expect(resolveLabelStyle('#10b981', 'polygon', { strokeOpacity: 0 }).strokeOpacity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Selected/hovered emphasis math
// ---------------------------------------------------------------------------

describe('emphasizedFillOpacity', () => {
  it('bumps the base for selected and hovered, leaving the resting state alone', () => {
    expect(emphasizedFillOpacity(0.2, {})).toBeCloseTo(0.2);
    expect(emphasizedFillOpacity(0.2, { hovered: true })).toBeCloseTo(0.25);
    expect(emphasizedFillOpacity(0.2, { selected: true })).toBeCloseTo(0.35);
  });

  it('clamps to a valid alpha so a high base does not exceed 1', () => {
    expect(emphasizedFillOpacity(0.95, { selected: true })).toBe(1);
    expect(emphasizedFillOpacity(1, { hovered: true })).toBe(1);
  });

  it('gives selected precedence over hovered', () => {
    expect(emphasizedFillOpacity(0.2, { selected: true, hovered: true })).toBeCloseTo(0.35);
  });
});

describe('emphasizedStrokeWidth', () => {
  it('thickens the stroke for selected/hovered, selected winning', () => {
    expect(emphasizedStrokeWidth(2, {})).toBe(2);
    expect(emphasizedStrokeWidth(2, { hovered: true })).toBe(2.5);
    expect(emphasizedStrokeWidth(2, { selected: true })).toBe(3);
    expect(emphasizedStrokeWidth(3, { selected: true, hovered: true })).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Override map reducers - merge, key isolation, immutability
// ---------------------------------------------------------------------------

describe('setStyleOverride', () => {
  it('accumulates patches for the same label instead of replacing them', () => {
    const a = setStyleOverride({}, 1, 7, { fillColor: '#ff0000' });
    const b = setStyleOverride(a, 1, 7, { strokeWidth: 5 });
    expect(b['1:7']).toEqual({ fillColor: '#ff0000', strokeWidth: 5 });
  });

  it('isolates overrides by label and by campaign', () => {
    let o: StyleOverrides = {};
    o = setStyleOverride(o, 1, 7, { fillColor: '#aaa' });
    o = setStyleOverride(o, 1, 8, { fillColor: '#bbb' }); // different label, same campaign
    o = setStyleOverride(o, 2, 7, { fillColor: '#ccc' }); // same label, different campaign
    expect(o['1:7']).toEqual({ fillColor: '#aaa' });
    expect(o['1:8']).toEqual({ fillColor: '#bbb' });
    expect(o['2:7']).toEqual({ fillColor: '#ccc' });
  });

  it('does not mutate the input map or the existing entry', () => {
    const original: StyleOverrides = { '1:7': { fillColor: '#ff0000' } };
    const snapshot = structuredClone(original);
    setStyleOverride(original, 1, 7, { strokeWidth: 5 });
    expect(original).toEqual(snapshot);
  });
});

describe('clearStyleOverride', () => {
  it('removes only the targeted label, leaving the rest intact', () => {
    const o: StyleOverrides = { '1:7': { fillColor: '#aaa' }, '1:8': { fillColor: '#bbb' } };
    const next = clearStyleOverride(o, 1, 7);
    expect(next).toEqual({ '1:8': { fillColor: '#bbb' } });
  });

  it('does not mutate the input map', () => {
    const o: StyleOverrides = { '1:7': { fillColor: '#aaa' } };
    const snapshot = structuredClone(o);
    clearStyleOverride(o, 1, 7);
    expect(o).toEqual(snapshot);
  });

  it('is a no-op when the label has no override', () => {
    const o: StyleOverrides = { '1:7': { fillColor: '#aaa' } };
    expect(clearStyleOverride(o, 9, 9)).toBe(o);
  });
});
