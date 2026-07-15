import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useTaskStore } from './task.store';
import { useCampaignStore } from './campaign.store';
import { useAccountStore } from '~/features/account/account.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import type { AnnotationTaskOut, CampaignOutFull } from '~/api/client';

const REQUIRED_FIELD = {
  id: 1,
  title: 'Crop',
  type: 'category' as const,
  required: true,
  description: null,
  options: [{ id: 1, name: 'Maize' }],
};

function primeTask(formFields: unknown[]) {
  const task = { id: 7, annotations: [], assignments: [] } as unknown as AnnotationTaskOut;
  useTaskStore.setState({ visibleTasks: [task], allTasks: [task], currentTaskIndex: 0 });
  useCampaignStore.setState({
    campaign: { id: 1, settings: { form_fields: formFields } } as unknown as CampaignOutFull,
  });
  useAccountStore.setState({ account: { id: 'u1' } as never });
}

describe('task mode submit guards required form fields', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useTaskStore.setState({ formValues: {}, activeFieldIndex: null, isSubmitting: false });
  });

  // The Enter hotkey calls submitAnnotation directly, bypassing the submit
  // button's disabled state - the guard has to live in the store.
  it('blocks a labelled submit while a required field is unanswered', async () => {
    primeTask([REQUIRED_FIELD]);
    const alert = vi.spyOn(useLayoutStore.getState(), 'showAlert');

    await useTaskStore.getState().submitAnnotation(1, '', 100);

    expect(alert).toHaveBeenCalledWith(expect.stringContaining('Crop'), 'error');
    expect(useTaskStore.getState().isSubmitting).toBe(false);
  });

  it('lets a skip through without answers, matching the backend', async () => {
    primeTask([REQUIRED_FIELD]);
    const alert = vi.spyOn(useLayoutStore.getState(), 'showAlert');

    await useTaskStore.getState().submitAnnotation(null, '', 100);

    expect(alert).not.toHaveBeenCalledWith(expect.stringContaining('Crop'), 'error');
  });

  it('resetAnnotationForm clears form values and active field index alongside the rest of the draft', () => {
    useTaskStore.setState({
      selectedLabelId: 5,
      comment: 'note',
      formValues: { '1': 'answer' },
      activeFieldIndex: 1,
    });
    useTaskStore.getState().resetAnnotationForm();
    const state = useTaskStore.getState();
    expect(state.formValues).toEqual({});
    expect(state.activeFieldIndex).toBeNull();
    expect(state.selectedLabelId).toBeNull();
    expect(state.comment).toBe('');
  });
});
