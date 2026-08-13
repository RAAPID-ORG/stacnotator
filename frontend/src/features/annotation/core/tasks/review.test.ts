import { describe, it, expect } from 'vitest';
import type { AnnotationOut, AnnotationTaskAssignmentOut } from '~/api/client';
import { reviewRows } from './review';

const annotation = (over: Partial<AnnotationOut>): AnnotationOut =>
  ({
    id: 1,
    label_id: 1,
    created_by_user_id: 'u1',
    geometry: { geometry: 'POINT (0 0)' },
    ...over,
  }) as AnnotationOut;

const assignment = (over: Partial<AnnotationTaskAssignmentOut>): AnnotationTaskAssignmentOut =>
  ({ user_id: 'u1', status: 'pending', ...over }) as AnnotationTaskAssignmentOut;

describe('reviewRows', () => {
  it('pairs an annotation with its matching assignment by user id', () => {
    const rows = reviewRows(
      [annotation({ created_by_user_id: 'u1' })],
      [assignment({ user_id: 'u1', status: 'done' })],
      'partial'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'annotation', userId: 'u1' });
  });

  it('produces a pending row for an assignment with no annotation yet', () => {
    const rows = reviewRows([], [assignment({ user_id: 'u2' })], 'partial');
    expect(rows).toEqual([
      { kind: 'pending', userId: 'u2', assignment: assignment({ user_id: 'u2' }) },
    ]);
  });

  it('includes an annotation that has no assignment record at all', () => {
    const rows = reviewRows([annotation({ created_by_user_id: 'u3' })], [], 'partial');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'annotation', userId: 'u3', assignment: null });
  });

  it('flags a non-authoritative annotation as conflicting when the task is conflicting', () => {
    const rows = reviewRows(
      [annotation({ created_by_user_id: 'u1', is_authoritative: false })],
      [],
      'conflicting'
    );
    expect(rows[0]).toMatchObject({ kind: 'annotation', isConflict: true });
  });

  it('does not flag the authoritative annotation as conflicting even on a conflicting task', () => {
    const rows = reviewRows(
      [annotation({ created_by_user_id: 'u1', is_authoritative: true })],
      [],
      'conflicting'
    );
    expect(rows[0]).toMatchObject({ kind: 'annotation', isConflict: false, isAuthoritative: true });
  });

  it('does not flag anything as conflicting when the task is not conflicting', () => {
    const rows = reviewRows([annotation({ created_by_user_id: 'u1' })], [], 'partial');
    expect(rows[0]).toMatchObject({ isConflict: false });
  });

  it('flags an annotation that does not count toward completion as extra', () => {
    const rows = reviewRows(
      [annotation({ created_by_user_id: 'u1', counts_toward_completion: false })],
      [],
      'partial'
    );
    expect(rows[0]).toMatchObject({ isExtra: true });
  });

  it('flags a skipped assignment on an annotation row', () => {
    const rows = reviewRows(
      [annotation({ created_by_user_id: 'u1' })],
      [assignment({ user_id: 'u1', status: 'skipped' })],
      'partial'
    );
    expect(rows[0]).toMatchObject({ isSkipped: true });
  });
});
