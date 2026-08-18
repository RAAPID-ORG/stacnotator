import { describe, it, expect } from 'vitest';
import type { TextFormField, NumberFormField } from '~/api/client';
import { isRemovingLabel, maySubmitTask, validateForm, type SubmitReadiness } from './annotation';

const REQUIRED_TEXT: TextFormField = {
  id: 1,
  title: 'Notes',
  required: true,
  type: 'text',
};

const REQUIRED_MULTILINE: TextFormField = {
  id: 2,
  title: 'Description',
  required: true,
  type: 'text',
  multiline: true,
};

const OPTIONAL_NUMBER: NumberFormField = {
  id: 3,
  title: 'Count',
  required: false,
  type: 'number',
};

describe('validateForm', () => {
  it('flags a missing required field', () => {
    expect(validateForm([REQUIRED_TEXT], {})).toEqual({ ok: false, missing: ['Notes'] });
  });

  it('never flags an absent optional field', () => {
    expect(validateForm([OPTIONAL_NUMBER], {})).toEqual({ ok: true, missing: [] });
  });

  it('is ok when every required field is answered', () => {
    const values = { '1': 'filled in', '3': 5 };
    expect(validateForm([REQUIRED_TEXT, OPTIONAL_NUMBER], values)).toEqual({
      ok: true,
      missing: [],
    });
  });

  it('treats a whitespace-only multiline answer as missing', () => {
    expect(validateForm([REQUIRED_MULTILINE], { '2': '   \n  ' })).toEqual({
      ok: false,
      missing: ['Description'],
    });
  });

  it('lists multiple missing titles in field order', () => {
    expect(validateForm([REQUIRED_TEXT, REQUIRED_MULTILINE], {})).toEqual({
      ok: false,
      missing: ['Notes', 'Description'],
    });
  });
});

describe('maySubmitTask', () => {
  const readiness = (overrides: Partial<SubmitReadiness> = {}): SubmitReadiness => ({
    selectedLabelId: 1,
    hasExistingLabel: false,
    mayLabel: true,
    isSubmitting: false,
    ...overrides,
  });

  it('allows a submission once a label is selected', () => {
    expect(maySubmitTask(readiness())).toBe(true);
  });

  // The empty payload is what Skip sends, and Skip has its own assignee check
  // and confirmation - Enter must not be a back door to it.
  it('refuses a submission with no label and none to remove', () => {
    expect(maySubmitTask(readiness({ selectedLabelId: null }))).toBe(false);
  });

  it('allows the label removal: nothing selected, but one of ours exists', () => {
    expect(maySubmitTask(readiness({ selectedLabelId: null, hasExistingLabel: true }))).toBe(true);
  });

  it('refuses while a submission is already in flight', () => {
    expect(maySubmitTask(readiness({ isSubmitting: true }))).toBe(false);
  });

  it('refuses when the labelling policy excludes the viewer', () => {
    expect(maySubmitTask(readiness({ mayLabel: false }))).toBe(false);
    expect(
      maySubmitTask(readiness({ mayLabel: false, selectedLabelId: null, hasExistingLabel: true }))
    ).toBe(false);
  });
});

describe('isRemovingLabel', () => {
  it('is a removal only with nothing selected and a label of ours on the task', () => {
    expect(isRemovingLabel({ selectedLabelId: null, hasExistingLabel: true })).toBe(true);
    expect(isRemovingLabel({ selectedLabelId: null, hasExistingLabel: false })).toBe(false);
    expect(isRemovingLabel({ selectedLabelId: 2, hasExistingLabel: true })).toBe(false);
  });
});
