import { describe, it, expect } from 'vitest';
import { gradientFor, formatTick } from './customMapColormaps';

describe('gradientFor', () => {
  it('viridis gradient contains first and last stops', () => {
    const g = gradientFor('viridis');
    expect(g).toMatch(/^linear-gradient\(to right/);
    expect(g).toContain('#440154');
    expect(g).toContain('#fde725');
  });

  it('is case-insensitive', () => {
    expect(gradientFor('Viridis')).toBe(gradientFor('viridis'));
    expect(gradientFor('PLASMA')).toBe(gradientFor('plasma'));
  });

  it('unknown name falls back to grayscale', () => {
    const g = gradientFor('unknown_colormap_xyz');
    expect(g).toContain('#000000');
    expect(g).toContain('#ffffff');
  });

  it('empty string falls back to grayscale', () => {
    const g = gradientFor('');
    expect(g).toContain('#000000');
    expect(g).toContain('#ffffff');
  });
});

describe('formatTick', () => {
  it('integer stays integer', () => {
    expect(formatTick(0)).toBe('0');
    expect(formatTick(1)).toBe('1');
    expect(formatTick(-5)).toBe('-5');
    expect(formatTick(100)).toBe('100');
  });

  it('0.5 rounds to one decimal', () => {
    expect(formatTick(0.5)).toBe('0.5');
  });

  it('truncates to 2 decimal places', () => {
    expect(formatTick(1.23456)).toBe('1.23');
  });

  it('trailing zeros stripped', () => {
    expect(formatTick(1.1)).toBe('1.1');
  });
});
