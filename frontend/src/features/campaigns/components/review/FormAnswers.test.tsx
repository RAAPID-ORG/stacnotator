import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormAnswers } from './FormAnswers';
import type { FormField } from '~/shared/utils/formValues';

const fields: FormField[] = [
  {
    id: 1,
    title: 'Crop',
    type: 'category',
    options: [
      { id: 10, name: 'Maize' },
      { id: 11, name: 'Wheat' },
    ],
  },
  { id: 2, title: 'Notes', type: 'text' },
];

describe('FormAnswers', () => {
  it('shows each answered field by its title and named option', () => {
    render(<FormAnswers fields={fields} values={{ '1': 10, '2': 'looks dry' }} />);
    expect(screen.getByText('Crop')).toBeTruthy();
    expect(screen.getByText('Maize')).toBeTruthy();
    expect(screen.getByText('looks dry')).toBeTruthy();
  });

  it('omits fields nobody answered rather than showing them empty', () => {
    render(<FormAnswers fields={fields} values={{ '1': 11 }} />);
    expect(screen.getByText('Wheat')).toBeTruthy();
    expect(screen.queryByText('Notes')).toBeNull();
  });

  it('says so when an annotation predates the form', () => {
    render(<FormAnswers fields={fields} values={null} />);
    expect(screen.getByText('No answers recorded.')).toBeTruthy();
    expect(screen.queryByTestId('form-answers')).toBeNull();
  });
});
