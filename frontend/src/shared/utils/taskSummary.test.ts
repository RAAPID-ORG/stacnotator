import { describe, expect, it } from 'vitest';
import type { TaskOut, TaskSummaryOut } from '~/api/client';
import { decodeTaskSummary, taskRowFromTaskOut } from './taskSummary';

const summary: TaskSummaryOut = {
  campaign_id: 1,
  server_time: '2026-01-01T00:00:00Z',
  users: {
    id: ['u-a', 'u-b'],
    display_name: ['alice', 'bob'],
    email: [null, null],
  },
  tasks: {
    id: [10, 11],
    annotation_number: [1, 2],
    task_set_id: [5, 5],
    task_status: ['done', 'pending'],
    claimed_by: [null, 1],
    claimed_at: [null, '2026-01-01T00:00:00Z'],
    lon: [1.5, 2.5],
    lat: [3.5, 4.5],
    nearby_annotation_count: [0, 2],
    drawn_by: [[], [0]],
  },
  assignments: { task: [0, 0, 1], user: [0, 1, 0], status: ['done', 'done', 'pending'] },
  answers: {
    id: [100, 101],
    task: [0, 0],
    user: [1, 0],
    label_id: [7, 7],
    outcome: ['labelled', 'labelled'],
    confidence: [3, null],
    flagged_for_review: [false, true],
    active_seconds: [12, null],
    is_authoritative: [false, false],
    counts_toward_completion: [true, true],
    comment: ['looks like forest', null],
    flag_comment: [null, 'check again'],
    updated_at: ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'],
    answered_field_ids: [['2'], []],
  },
};

describe('decodeTaskSummary', () => {
  it('puts each assignment and answer on its own task, with the person it names', () => {
    const [first, second] = decodeTaskSummary(summary);

    expect(first.assignments.map((a) => [a.user_display_name, a.status])).toEqual([
      ['alice', 'done'],
      ['bob', 'done'],
    ]);
    expect(first.annotations.map((a) => [a.id, a.created_by_user_id, a.comment])).toEqual([
      [100, 'u-b', 'looks like forest'],
      [101, 'u-a', null],
    ]);
    expect(second.annotations).toEqual([]);
    expect(second.assignments).toEqual([
      { user_id: 'u-a', status: 'pending', user_display_name: 'alice', user_email: null },
    ]);
  });

  it('resolves claims and drawn-by from the users lookup', () => {
    const [first, second] = decodeTaskSummary(summary);

    expect(first.claimed_by_user_id).toBeNull();
    expect(second.claimed_by_user_id).toBe('u-b');
    expect(second.claimed_by_display_name).toBe('bob');
    expect(second.drawn_by_user_ids).toEqual(['u-a']);
    expect([second.lon, second.lat]).toEqual([2.5, 4.5]);
  });
});

describe('taskRowFromTaskOut', () => {
  it('keeps the summary fields, centres on the geometry and lists only answered fields', () => {
    const task: TaskOut = {
      id: 3,
      annotation_number: 4,
      task_set_id: 5,
      task_status: 'partial',
      geometry_wkt: 'POLYGON ((0 0, 2 0, 2 2, 0 2, 0 0))',
      assignments: [{ user_id: 'u-a', status: 'done', user_display_name: 'alice' }],
      annotations: [
        {
          id: 9,
          label_id: 7,
          outcome: 'labelled',
          comment: null,
          created_by_user_id: 'u-a',
          created_by_user_display_name: 'alice',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          confidence: 4,
          is_authoritative: false,
          flagged_for_review: false,
          flag_comment: null,
          form_values: { b: 'x', a: 2, empty: '', none: [] },
        },
      ],
    };

    const row = taskRowFromTaskOut(task);

    expect([row.lon, row.lat]).toEqual([1, 1]);
    expect(row.claimed_by_user_id).toBeNull();
    expect(row.assignments).toEqual([
      { user_id: 'u-a', status: 'done', user_display_name: 'alice', user_email: null },
    ]);
    expect(
      taskRowFromTaskOut({
        ...task,
        geometry_wkt: 'MULTIPOLYGON (((0 0, 2 0, 2 2, 0 0)), ((4 4, 6 4, 6 6, 4 4)))',
      })
    ).toMatchObject({ lon: 3, lat: 3 });
    expect(row.annotations[0]).toMatchObject({
      id: 9,
      label_id: 7,
      counts_toward_completion: true,
      answered_field_ids: ['a', 'b'],
    });
  });
});
