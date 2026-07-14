import type { FormField } from './formValues';

// activeIndex convention: null = no field focused (digits select labels, task mode)
// 0..fields.length-1 = custom field focused.
export function cycleFieldIndex(
  current: number | null,
  fieldCount: number,
  direction: 1 | -1
): number | null {
  if (fieldCount === 0) return null;
  if (direction === 1) {
    if (current === null) return 0;
    return current === fieldCount - 1 ? null : current + 1;
  }
  if (current === null) return fieldCount - 1;
  return current === 0 ? null : current - 1;
}

export function digitTargetsOption(field: FormField): boolean {
  return field.type === 'select' || field.type === 'multiselect';
}

export function optionIdForDigit(field: FormField, digit: number): number | null {
  if (!digitTargetsOption(field) || !('options' in field)) return null;
  const option = field.options[digit - 1];
  return option ? option.id : null;
}
