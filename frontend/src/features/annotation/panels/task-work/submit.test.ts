import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '~/api/client';
import type {
  AnnotationFromTaskOut,
  AnnotationTaskOut,
  AnnotationTaskSubmitResponse,
  ValidateLabelSubmissionsResponse,
} from '~/api/client';
import type { FormField } from '~/features/annotation/core/apiTypes';
import { submitCurrent, type SubmitParams } from './submit';

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return {
    ...actual,
    completeAnnotationTask: vi.fn(),
    deleteAnnotation: vi.fn(),
    validateAnnotationSubmission: vi.fn(),
  };
});

const annotation = (overrides: Partial<AnnotationFromTaskOut> = {}): AnnotationFromTaskOut => ({
  id: 99,
  label_id: 10,
  comment: null,
  created_by_user_id: 'u1',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  confidence: 3,
  is_authoritative: false,
  flagged_for_review: false,
  flag_comment: null,
  ...overrides,
});

const envelope = <T>(data: T) => ({
  data,
  request: new Request('http://localhost/api'),
  response: new Response(),
});

const submitted = (overrides: Partial<AnnotationTaskSubmitResponse> = {}) =>
  envelope<AnnotationTaskSubmitResponse>({
    annotation: annotation(),
    assignment_status: 'done',
    task_status: 'done',
    ...overrides,
  });

const validated = (status: ValidateLabelSubmissionsResponse['status']) =>
  envelope<ValidateLabelSubmissionsResponse>({ status });

const TASK: AnnotationTaskOut = {
  id: 1,
  annotation_number: 1,
  task_set_id: 1,
  task_status: 'pending',
  geometry: { id: 1, geometry: 'POINT(0 0)' },
  annotations: [],
  assignments: [{ user_id: 'u1', status: 'pending' }],
};

const BASE_PARAMS: SubmitParams = {
  campaignId: 5,
  task: TASK,
  currentUserId: 'u1',
  fields: [],
  labelId: 10,
  comment: '',
  confidence: 3,
  flagged: false,
  flagComment: '',
  formValues: {},
  knnValidationEnabled: false,
};

beforeEach(() => {
  vi.mocked(api.completeAnnotationTask).mockReset();
  vi.mocked(api.deleteAnnotation).mockReset();
  vi.mocked(api.validateAnnotationSubmission).mockReset();
});

describe('submitCurrent', () => {
  it('returns needsConfirm on a KNN mismatch and never calls completeAnnotationTask', async () => {
    vi.mocked(api.validateAnnotationSubmission).mockResolvedValue(validated('mismatch'));

    const outcome = await submitCurrent({ ...BASE_PARAMS, knnValidationEnabled: true });

    expect(outcome).toEqual({ kind: 'needsConfirm' });
    expect(api.completeAnnotationTask).not.toHaveBeenCalled();
  });

  it.each(['ok', 'skipped_no_embedding', 'skipped_insufficient_data', 'disabled'] as const)(
    'submits straight through when KNN validation returns %s',
    async (status) => {
      vi.mocked(api.validateAnnotationSubmission).mockResolvedValue(validated(status));
      vi.mocked(api.completeAnnotationTask).mockResolvedValue(submitted());

      const outcome = await submitCurrent({ ...BASE_PARAMS, knnValidationEnabled: true });

      expect(outcome.kind).toBe('submitted');
    }
  );

  it('resubmits without re-checking KNN once the caller confirms a mismatch', async () => {
    vi.mocked(api.completeAnnotationTask).mockResolvedValue(submitted());

    const outcome = await submitCurrent({
      ...BASE_PARAMS,
      knnValidationEnabled: true,
      confirmMismatch: true,
    });

    expect(outcome.kind).toBe('submitted');
    expect(api.validateAnnotationSubmission).not.toHaveBeenCalled();
  });

  it('a successful submit updates the task with the new annotation and statuses', async () => {
    const newAnnotation = annotation({ comment: 'hi' });
    vi.mocked(api.completeAnnotationTask).mockResolvedValue(
      submitted({ annotation: newAnnotation })
    );

    const outcome = await submitCurrent(BASE_PARAMS);

    expect(outcome.kind).toBe('submitted');
    if (outcome.kind !== 'submitted') throw new Error('expected submitted');
    expect(outcome.task.task_status).toBe('done');
    expect(outcome.task.annotations).toEqual([newAnnotation]);
    expect(outcome.task.assignments).toEqual([{ user_id: 'u1', status: 'done' }]);
  });

  it('a skip (no label, no existing annotation) still goes through completeAnnotationTask and submits', async () => {
    vi.mocked(api.completeAnnotationTask).mockResolvedValue(
      submitted({ annotation: null, assignment_status: 'skipped', task_status: 'pending' })
    );

    const outcome = await submitCurrent({ ...BASE_PARAMS, labelId: null });

    expect(outcome.kind).toBe('submitted');
    expect(api.deleteAnnotation).not.toHaveBeenCalled();
  });

  it('blocks the submit when a required field is unanswered, without calling the API', async () => {
    const fields: FormField[] = [{ id: 1, title: 'Condition', required: true, type: 'text' }];

    const outcome = await submitCurrent({ ...BASE_PARAMS, fields, formValues: {} });

    expect(outcome).toEqual({ kind: 'blocked', missing: ['Condition'] });
    expect(api.completeAnnotationTask).not.toHaveBeenCalled();
  });

  it('removes the label via deleteAnnotation when clearing an existing label with no comment', async () => {
    const taskWithAnnotation: AnnotationTaskOut = {
      ...TASK,
      annotations: [annotation({ id: 7 })],
    };
    vi.mocked(api.deleteAnnotation).mockResolvedValue(
      submitted({ annotation: null, assignment_status: 'pending', task_status: 'pending' })
    );

    const outcome = await submitCurrent({
      ...BASE_PARAMS,
      task: taskWithAnnotation,
      labelId: null,
      comment: '',
    });

    expect(outcome.kind).toBe('removed');
    if (outcome.kind !== 'removed') throw new Error('expected removed');
    expect(outcome.task.annotations).toEqual([]);
    expect(api.completeAnnotationTask).not.toHaveBeenCalled();
  });

  it('returns an error outcome when completeAnnotationTask rejects', async () => {
    vi.mocked(api.completeAnnotationTask).mockRejectedValue(new Error('network down'));

    const outcome = await submitCurrent(BASE_PARAMS);

    expect(outcome).toEqual({ kind: 'error', message: 'network down' });
  });
});
