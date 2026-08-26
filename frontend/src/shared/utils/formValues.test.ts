import { describe, expect, it } from 'vitest';
import { answeredFields, formatFormValue, type FormField } from './formValues';

const category: FormField = {
  id: 1,
  title: 'Crop',
  type: 'category',
  options: [
    { id: 10, name: 'Maize' },
    { id: 11, name: 'Wheat' },
  ],
};
const multi: FormField = { ...category, id: 2, title: 'Damage', type: 'multicategory' };
const text: FormField = { id: 3, title: 'Notes', type: 'text' };
const range: FormField = { id: 4, title: 'Season', type: 'daterange' };

describe('formatFormValue', () => {
  it('names the option rather than showing its id', () => {
    expect(formatFormValue(category, 10)).toBe('Maize');
  });

  it('joins multicategory answers the way the CSV export does', () => {
    expect(formatFormValue(multi, [10, 11])).toBe('Maize; Wheat');
  });

  it('renders a date range as start/end', () => {
    expect(formatFormValue(range, { start: '2024-01-01', end: '2024-03-01' })).toBe(
      '2024-01-01/2024-03-01'
    );
  });

  it('treats unanswered fields as absent, including an empty selection', () => {
    expect(formatFormValue(text, null)).toBeNull();
    expect(formatFormValue(text, '')).toBeNull();
    expect(formatFormValue(multi, [])).toBeNull();
  });

  // A field can be renamed or an option removed after answers exist; the table
  // still has to render, so an unknown id falls back to itself.
  it('falls back to the raw id when an option no longer exists', () => {
    expect(formatFormValue(category, 99)).toBe('99');
  });
});

describe('answeredFields', () => {
  it('keeps form order and drops what was never answered', () => {
    expect(answeredFields([category, multi, text], { '3': 'hello', '1': 10 })).toEqual([
      { field: category, text: 'Maize' },
      { field: text, text: 'hello' },
    ]);
  });

  it('is empty when nothing was answered', () => {
    expect(answeredFields([category], null)).toEqual([]);
    expect(answeredFields([category], {})).toEqual([]);
  });
});
