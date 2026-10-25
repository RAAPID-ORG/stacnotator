import type { CampaignSettingsCreate } from '~/api/client';
import i18n from '~/shared/i18n';

const t = i18n.getFixedT(null, 'campaigns');

export type FormField = NonNullable<CampaignSettingsCreate['form_fields']>[number];

export function formFieldSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'field';
}

function fieldLabel(field: FormField): string {
  return field.title.trim() || t('validation.formFields.fallbackName', { id: field.id });
}

export const MAX_FIELDS = 100;
export const MAX_OPTIONS = 200;

/** Duplicates the subset of backend/src/campaigns/form_fields.py rules we surface
 *  inline while editing. The backend stays the authority and rejects anything the
 *  editor cannot produce, so only violations reachable from the editor live here. */
export function validateFormFields(fields: FormField[]): string[] {
  const errors: string[] = [];

  const slugs = fields.map((f) => formFieldSlug(f.title));
  if (new Set(slugs).size !== slugs.length) {
    errors.push(t('validation.formFields.uniqueTitles'));
  }

  for (const field of fields) {
    if (!field.title.trim()) {
      errors.push(t('validation.formFields.needsTitle', { id: field.id }));
    }

    if (field.type === 'category' || field.type === 'multicategory') {
      if (field.options.length === 0) {
        errors.push(t('validation.formFields.needsOption', { field: fieldLabel(field) }));
      } else if (field.options.some((o) => !o.name.trim())) {
        errors.push(t('validation.formFields.unnamedOption', { field: fieldLabel(field) }));
      }
    }

    if (field.type === 'number') {
      if (field.min != null && field.max != null && field.min > field.max) {
        errors.push(t('validation.formFields.minAboveMax', { field: fieldLabel(field) }));
      }
    }
  }

  return errors;
}

export interface FormFieldsDiff {
  added: FormField[];
  edited: FormField[];
  /** Fields dropped from the draft. Saving deletes them and every answer
   *  annotators recorded for them, so callers must confirm first. */
  deleted: FormField[];
}

/** Compare a draft against the campaign's saved fields. Field ids are the
 *  identity anchor (stored answers key off them), so an id present on both
 *  sides is the same field however much its content changed. */
export function diffFormFields(original: FormField[], draft: FormField[]): FormFieldsDiff {
  const byId = new Map(original.map((f) => [f.id, f]));
  const draftIds = new Set(draft.map((f) => f.id));
  return {
    added: draft.filter((f) => !byId.has(f.id)),
    edited: draft.filter((f) => {
      const before = byId.get(f.id);
      return before !== undefined && JSON.stringify(before) !== JSON.stringify(f);
    }),
    deleted: original.filter((f) => !draftIds.has(f.id)),
  };
}

const optionIdsOf = (field: FormField): number[] =>
  'options' in field ? field.options.map((option) => option.id) : [];

const numberTypeOf = (field: FormField) => (field.type === 'number' ? field.number_type : null);

/** Fields the server will refuse to save: ones with stored answers whose type,
 *  number type or options change, since those answers would become unreadable. */
export function refusedReshapes(
  original: FormField[],
  draft: FormField[],
  answeredIds: number[]
): FormField[] {
  const byId = new Map(original.map((f) => [f.id, f]));
  return draft.filter((field) => {
    const before = byId.get(field.id);
    if (!before || !answeredIds.includes(field.id)) return false;
    const keptOptions = new Set(optionIdsOf(field));
    return (
      before.type !== field.type ||
      numberTypeOf(before) !== numberTypeOf(field) ||
      optionIdsOf(before).some((id) => !keptOptions.has(id))
    );
  });
}
