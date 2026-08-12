import type { FormField } from '~/features/annotation/core/apiTypes';
import { applyCategoryOption, type FormValues } from './formValues';

// activeIndex convention: null = no field focused (digits select labels, task mode)
// LABEL_FIELD_INDEX = the primary label selector focused (digits still select labels)
// 0..fields.length-1 = custom field focused.
export const LABEL_FIELD_INDEX = -1;

// null and LABEL_FIELD_INDEX both route digits to labels, so entering the cycle
// forward skips to the first custom field rather than re-highlighting a slot
// that is already the active digit target.
export function cycleFieldIndex(
  current: number | null,
  fieldCount: number,
  direction: 1 | -1
): number | null {
  if (fieldCount === 0) return null;
  if (direction === 1) {
    if (current === null) return 0;
    if (current === LABEL_FIELD_INDEX) return 0;
    return current === fieldCount - 1 ? LABEL_FIELD_INDEX : current + 1;
  }
  if (current === null) return fieldCount - 1;
  if (current === 0) return LABEL_FIELD_INDEX;
  if (current === LABEL_FIELD_INDEX) return fieldCount - 1;
  return current - 1;
}

type OptionFormField = Extract<FormField, { type: 'category' | 'multicategory' }>;

function digitTargetsOption(field: FormField): field is OptionFormField {
  return field.type === 'category' || field.type === 'multicategory';
}

/** Digit pressed while `field` is the active custom form field: toggles the
 * matching option on option-valued fields, otherwise returns the field whose
 * input the caller should focus so the digit starts a typed value. */
export function applyFieldDigit(
  field: FormField,
  digitKey: string,
  values: FormValues,
  setValues: (next: FormValues) => void
): number | null {
  if (!digitTargetsOption(field)) return field.id;
  const option = field.options[parseInt(digitKey, 10) - 1];
  if (option) setValues(applyCategoryOption(values, field, option.id));
  return null;
}

export interface FormFieldKeyContext {
  fields: FormField[];
  activeIndex: number | null;
  values: FormValues;
  setValues: (next: FormValues) => void;
  setActiveIndex: (index: number | null) => void;
}

/** What the caller must do with the DOM after a handled key. `handled` says
 * the event was consumed, so callers can fall through to their own bindings
 * for the same keys (label digits, submit on Enter); `focusFieldId` names the
 * field whose input to focus - domain decides which field that is, the
 * feature layer owns the focus call. */
export interface FormFieldKeyResult {
  handled: boolean;
  focusFieldId: number | null;
}

const IGNORED: FormFieldKeyResult = { handled: false, focusFieldId: null };

/** Form-field keyboard handling shared by the task-mode and open-mode hooks. */
export function handleFormFieldKey(e: KeyboardEvent, ctx: FormFieldKeyContext): FormFieldKeyResult {
  const { fields, activeIndex } = ctx;
  const activeField = activeIndex !== null && activeIndex >= 0 ? fields[activeIndex] : undefined;

  if (activeField && /^[0-9]$/.test(e.key)) {
    e.preventDefault();
    return {
      handled: true,
      focusFieldId: applyFieldDigit(activeField, e.key, ctx.values, ctx.setValues),
    };
  }

  if (activeField && e.key === 'Enter' && !digitTargetsOption(activeField)) {
    e.preventDefault();
    return { handled: true, focusFieldId: activeField.id };
  }

  if (e.key === 'Tab' && fields.length > 0) {
    e.preventDefault();
    ctx.setActiveIndex(cycleFieldIndex(activeIndex, fields.length, e.shiftKey ? -1 : 1));
    return { handled: true, focusFieldId: null };
  }

  if (e.key === 'Escape' && activeIndex !== null) {
    e.preventDefault();
    ctx.setActiveIndex(null);
    return { handled: true, focusFieldId: null };
  }

  return IGNORED;
}
