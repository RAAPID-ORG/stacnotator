import { describe, it, expect } from 'vitest';
import {
  buildAnnotationTileFlatStyle,
  EDITING_ID_VAR,
  NO_EDITING_ID,
  type TileLabelStyle,
} from './annotationTileStyle';

const labels: TileLabelStyle[] = [
  { id: 1, fillColor: 'rgba(255,0,0,0.2)', strokeColor: '#ff0000', strokeWidth: 2 },
  { id: 2, fillColor: 'rgba(0,0,255,0.2)', strokeColor: '#0000ff', strokeWidth: 3 },
];

describe('buildAnnotationTileFlatStyle', () => {
  it('emits fill, stroke and width style keys', () => {
    const style = buildAnnotationTileFlatStyle(labels);
    expect(style).toHaveProperty('fill-color');
    expect(style).toHaveProperty('stroke-color');
    expect(style).toHaveProperty('stroke-width');
  });

  it('maps each label id to its colors via a match expression', () => {
    const style = buildAnnotationTileFlatStyle(labels);
    const json = JSON.stringify(style['fill-color']);
    expect(json).toContain('match');
    expect(json).toContain('labelId');
    expect(json).toContain('rgba(255,0,0,0.2)');
    expect(json).toContain('rgba(0,0,255,0.2)');
  });

  it('hides the feature whose annotationId equals the editingId variable', () => {
    const style = buildAnnotationTileFlatStyle(labels);
    const json = JSON.stringify(style['fill-color']);
    expect(json).toContain(EDITING_ID_VAR);
    expect(json).toContain('annotationId');
    // transparent paint for the edited feature so the edit layer owns it
    expect(json).toContain('rgba(0,0,0,0)');
  });

  it('still produces valid style keys when there are no labels', () => {
    const style = buildAnnotationTileFlatStyle([]);
    expect(style).toHaveProperty('fill-color');
    expect(style).toHaveProperty('stroke-color');
  });

  it('exposes a sentinel meaning no feature is being edited', () => {
    expect(NO_EDITING_ID).toBe(-1);
  });
});
