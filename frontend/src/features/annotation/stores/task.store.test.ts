import { describe, expect, it, beforeEach } from 'vitest';
import { useTaskStore } from './task.store';

describe('custom form draft state', () => {
  beforeEach(() => {
    useTaskStore.setState({ formValues: {}, activeFieldIndex: null });
  });

  it('sets form values and active field index', () => {
    useTaskStore.getState().setFormValues({ '1': 'answer' });
    useTaskStore.getState().setActiveFieldIndex(2);
    expect(useTaskStore.getState().formValues).toEqual({ '1': 'answer' });
    expect(useTaskStore.getState().activeFieldIndex).toBe(2);
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
