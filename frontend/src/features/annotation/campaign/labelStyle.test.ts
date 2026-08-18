import { describe, it, expect } from 'vitest';
import {
  resolveLabelStyle,
  emphasizedFillOpacity,
  emphasizedStrokeWidth,
  toStyleSpec,
  toDraftStyleSpec,
} from './labelStyle';

const RED = resolveLabelStyle('#ff0000', 'polygon');

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

describe('toStyleSpec', () => {
  it('bakes color + opacity into an rgba() string for fill and stroke', () => {
    const spec = toStyleSpec(RED);
    expect(spec.fill).toEqual({ color: 'rgba(255,0,0,0.2)' });
    expect(spec.stroke).toEqual({ color: 'rgba(255,0,0,1)', width: 2 });
  });

  it('grows the circle radius for hovered, then more for selected', () => {
    expect(toStyleSpec(RED).circle?.radius).toBe(6);
    expect(toStyleSpec(RED, { hovered: true }).circle?.radius).toBe(7);
    expect(toStyleSpec(RED, { selected: true }).circle?.radius).toBe(8);
  });

  it('carries emphasis into the fill/stroke opacity and width too', () => {
    const spec = toStyleSpec(RED, { selected: true });
    expect(spec.fill).toEqual({ color: 'rgba(255,0,0,0.35)' });
    expect(spec.stroke).toEqual({ color: 'rgba(255,0,0,1)', width: 3 });
  });

  it('has no dash - only the draft preview is dashed', () => {
    expect(toStyleSpec(RED).stroke?.dash).toBeUndefined();
  });
});

describe('toDraftStyleSpec', () => {
  it('dashes the stroke and caps fill opacity at 0.15', () => {
    const bright = resolveLabelStyle('#ff0000', 'polygon', { fillOpacity: 0.8 });
    const spec = toDraftStyleSpec(bright);
    expect(spec.stroke?.dash).toEqual([6, 4]);
    expect(spec.fill).toEqual({ color: 'rgba(255,0,0,0.15)' });
  });

  it('leaves a fill opacity already below the cap untouched', () => {
    const dim = resolveLabelStyle('#ff0000', 'polygon', { fillOpacity: 0.1 });
    expect(toDraftStyleSpec(dim).fill).toEqual({ color: 'rgba(255,0,0,0.1)' });
  });

  it('uses a fixed point radius of 5, independent of emphasis', () => {
    expect(toDraftStyleSpec(RED).circle?.radius).toBe(5);
  });
});
