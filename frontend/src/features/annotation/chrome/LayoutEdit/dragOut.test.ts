import { describe, expect, it } from 'vitest';
import { MOVE_THRESHOLD_PX, step } from './dragOut';
import type { DragOutGeometry, DragOutState } from './dragOut';

const geometry: DragOutGeometry = {
  canvasRect: { left: 0, top: 0, width: 1206 },
  scrollTop: 0,
  layout: [],
};

const idle: DragOutState = { phase: 'idle' };

describe('dragOut state machine', () => {
  it('pointerdown starts a pending drag at the origin', () => {
    const next = step(
      idle,
      { type: 'pointerdown', id: 'a', size: { w: 10, h: 9 }, x: 100, y: 100 },
      geometry
    );
    expect(next).toEqual({
      phase: 'pending',
      id: 'a',
      size: { w: 10, h: 9 },
      origin: { x: 100, y: 100 },
    });
  });

  it('stays pending while movement is below the threshold', () => {
    const pending = step(
      idle,
      { type: 'pointerdown', id: 'a', size: { w: 10, h: 9 }, x: 100, y: 100 },
      geometry
    );
    const next = step(
      pending,
      { type: 'pointermove', x: 100 + MOVE_THRESHOLD_PX - 1, y: 100 },
      geometry
    );
    expect(next.phase).toBe('pending');
  });

  it('a pointerup while still pending is a click, not a drop', () => {
    const pending = step(
      idle,
      { type: 'pointerdown', id: 'a', size: { w: 10, h: 9 }, x: 100, y: 100 },
      geometry
    );
    const clicked = step(pending, { type: 'pointerup' }, geometry);
    expect(clicked).toEqual({ phase: 'clicked', id: 'a' });
  });

  it('crossing the threshold transitions to dragging with a snapped cell', () => {
    const pending = step(
      idle,
      { type: 'pointerdown', id: 'a', size: { w: 10, h: 9 }, x: 100, y: 100 },
      geometry
    );
    const dragging = step(
      pending,
      { type: 'pointermove', x: 100 + MOVE_THRESHOLD_PX + 20, y: 100 },
      geometry
    );
    expect(dragging.phase).toBe('dragging');
    if (dragging.phase === 'dragging') {
      expect(dragging.id).toBe('a');
      expect(typeof dragging.cell.x).toBe('number');
      expect(typeof dragging.cell.y).toBe('number');
      expect(typeof dragging.cell.free).toBe('boolean');
    }
  });

  it('Escape cancels a pending drag back to idle', () => {
    const pending = step(
      idle,
      { type: 'pointerdown', id: 'a', size: { w: 10, h: 9 }, x: 100, y: 100 },
      geometry
    );
    expect(step(pending, { type: 'cancel' }, geometry)).toEqual({ phase: 'idle' });
  });

  it('Escape cancels an in-progress drag back to idle', () => {
    const pending = step(
      idle,
      { type: 'pointerdown', id: 'a', size: { w: 10, h: 9 }, x: 100, y: 100 },
      geometry
    );
    const dragging = step(
      pending,
      { type: 'pointermove', x: 100 + MOVE_THRESHOLD_PX + 20, y: 100 },
      geometry
    );
    expect(step(dragging, { type: 'cancel' }, geometry)).toEqual({ phase: 'idle' });
  });

  it('drop reports the snapped cell when released over a free cell', () => {
    const pending = step(
      idle,
      { type: 'pointerdown', id: 'a', size: { w: 10, h: 9 }, x: 600, y: 200 },
      geometry
    );
    const dragging = step(pending, { type: 'pointermove', x: 620, y: 200 }, geometry);
    const dropped = step(dragging, { type: 'pointerup' }, geometry);
    expect(dropped.phase).toBe('dropped');
    if (dropped.phase === 'dropped') {
      expect(dropped.id).toBe('a');
      expect(typeof dropped.cell.x).toBe('number');
      expect(typeof dropped.cell.y).toBe('number');
    }
  });

  it('releasing over an occupied cell cancels rather than dropping', () => {
    const occupied: DragOutGeometry = {
      canvasRect: { left: 0, top: 0, width: 1206 },
      scrollTop: 0,
      layout: [{ i: 'existing', x: 0, y: 0, w: 60, h: 60 }],
    };
    const pending = step(
      idle,
      { type: 'pointerdown', id: 'a', size: { w: 10, h: 9 }, x: 0, y: 0 },
      occupied
    );
    const dragging = step(pending, { type: 'pointermove', x: 30, y: 0 }, occupied);
    const result = step(dragging, { type: 'pointerup' }, occupied);
    expect(result).toEqual({ phase: 'cancelled' });
  });

  it('releasing back over the tray itself cancels even over an otherwise-free cell', () => {
    // The tray floats above the canvas, so a release point that hit-tests
    // back to the tray's own panel isn't a real drop target, no matter what
    // grid cell happens to be underneath it.
    const pending = step(
      idle,
      { type: 'pointerdown', id: 'a', size: { w: 10, h: 9 }, x: 600, y: 200 },
      geometry
    );
    const dragging = step(pending, { type: 'pointermove', x: 620, y: 200 }, geometry);
    expect(dragging.phase).toBe('dragging');
    if (dragging.phase === 'dragging') expect(dragging.cell.free).toBe(true);
    const result = step(dragging, { type: 'pointerup', overExcludedRegion: true }, geometry);
    expect(result).toEqual({ phase: 'cancelled' });
  });

  it('a plain click still places the item even though it releases over the tray by definition', () => {
    // overExcludedRegion is meaningless for a below-threshold release: the
    // caller wouldn't even compute it for a click, but the reducer must not
    // treat a stray true here as a reason to swallow the click.
    const pending = step(
      idle,
      { type: 'pointerdown', id: 'a', size: { w: 10, h: 9 }, x: 100, y: 100 },
      geometry
    );
    const clicked = step(pending, { type: 'pointerup', overExcludedRegion: true }, geometry);
    expect(clicked).toEqual({ phase: 'clicked', id: 'a' });
  });
});
