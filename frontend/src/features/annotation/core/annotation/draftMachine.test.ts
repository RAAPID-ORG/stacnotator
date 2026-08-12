import { describe, it, expect } from 'vitest';
import type { TextFormField } from '~/api/client';
import {
  beginSketch,
  drawEnd,
  edit,
  commitRequested,
  commitResolved,
  close,
  type DraftState,
} from './draftMachine';

const REQUIRED_FIELD: TextFormField = { id: 1, title: 'Notes', required: true, type: 'text' };

const POINT: GeoJSON.Point = { type: 'Point', coordinates: [1, 2] };
const POINT_2: GeoJSON.Point = { type: 'Point', coordinates: [3, 4] };

describe('beginSketch', () => {
  it('idle -> sketching with the chosen label', () => {
    expect(beginSketch(7)).toEqual({ phase: 'sketching', labelId: 7 });
  });
});

describe('drawEnd', () => {
  it('sketch -> draft on drawEnd with fields', () => {
    const sketching = beginSketch(7);
    const result = drawEnd(sketching, POINT, [REQUIRED_FIELD]);
    expect(result).toEqual({
      next: { phase: 'draft', labelId: 7, geometry: POINT },
      action: 'draft',
    });
  });

  it('sketch -> save-immediately signal without fields', () => {
    const sketching = beginSketch(7);
    const result = drawEnd(sketching, POINT, []);
    expect(result).toEqual({ next: { phase: 'idle' }, action: 'save' });
  });

  it('is a no-op outside sketching', () => {
    const idle: DraftState = { phase: 'idle' };
    expect(drawEnd(idle, POINT, [REQUIRED_FIELD]).next).toBe(idle);
  });
});

describe('edit', () => {
  it('updates the geometry of an open draft', () => {
    const draft: DraftState = { phase: 'draft', labelId: 7, geometry: POINT };
    expect(edit(draft, POINT_2)).toEqual({ phase: 'draft', labelId: 7, geometry: POINT_2 });
  });

  it('is a no-op outside draft', () => {
    const sketching = beginSketch(7);
    expect(edit(sketching, POINT_2)).toBe(sketching);
  });
});

describe('commitRequested / commitResolved', () => {
  it('draft -> committing', () => {
    const draft: DraftState = { phase: 'draft', labelId: 7, geometry: POINT };
    expect(commitRequested(draft)).toEqual({ phase: 'committing', labelId: 7, geometry: POINT });
  });

  it('commitRequested while committing is a no-op', () => {
    const committing: DraftState = { phase: 'committing', labelId: 7, geometry: POINT };
    expect(commitRequested(committing)).toBe(committing);
  });

  it('commitResolved success clears the draft', () => {
    const committing: DraftState = { phase: 'committing', labelId: 7, geometry: POINT };
    expect(commitResolved(committing, 'success')).toEqual({ phase: 'idle' });
  });

  it('commitResolved failure returns to draft so the same answers can be retried', () => {
    const committing: DraftState = { phase: 'committing', labelId: 7, geometry: POINT };
    expect(commitResolved(committing, 'failure')).toEqual({
      phase: 'draft',
      labelId: 7,
      geometry: POINT,
    });
  });

  it('commitResolved is a no-op outside committing', () => {
    const draft: DraftState = { phase: 'draft', labelId: 7, geometry: POINT };
    expect(commitResolved(draft, 'success')).toBe(draft);
  });
});

describe('close', () => {
  it('close with incomplete required fields discards', () => {
    const draft: DraftState = { phase: 'draft', labelId: 7, geometry: POINT };
    const result = close(draft, [REQUIRED_FIELD], {});
    expect(result).toEqual({ next: { phase: 'idle' }, action: 'discard' });
  });

  it('close with complete saves', () => {
    const draft: DraftState = { phase: 'draft', labelId: 7, geometry: POINT };
    const result = close(draft, [REQUIRED_FIELD], { '1': 'filled in' });
    expect(result).toEqual({ next: { phase: 'idle' }, action: 'save' });
  });

  it('close is a no-op (nothing to save) outside draft', () => {
    const idle: DraftState = { phase: 'idle' };
    expect(close(idle, [REQUIRED_FIELD], {})).toEqual({ next: idle, action: 'discard' });
  });

  it('drawing again while a draft is open auto-commits the previous one', () => {
    // Complete draft for label 7, then the caller starts a new sketch for
    const openDraft: DraftState = { phase: 'draft', labelId: 7, geometry: POINT };
    const closed = close(openDraft, [REQUIRED_FIELD], { '1': 'filled in' });
    expect(closed.action).toBe('save');
    expect(closed.next).toEqual({ phase: 'idle' });

    const sketching = beginSketch(8);
    expect(sketching).toEqual({ phase: 'sketching', labelId: 8 });

    const drawn = drawEnd(sketching, POINT_2, [REQUIRED_FIELD]);
    expect(drawn).toEqual({
      next: { phase: 'draft', labelId: 8, geometry: POINT_2 },
      action: 'draft',
    });
  });

  it('drawing again over an incomplete draft discards it instead', () => {
    const openDraft: DraftState = { phase: 'draft', labelId: 7, geometry: POINT };
    const closed = close(openDraft, [REQUIRED_FIELD], {});
    expect(closed.action).toBe('discard');
  });
});
