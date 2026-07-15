import type { CampaignSettingsCreate } from '~/api/client';

export type FormField = NonNullable<CampaignSettingsCreate['form_fields']>[number];

export function formFieldSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function fieldLabel(field: FormField): string {
  return field.title.trim() || `field ${field.id}`;
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
    errors.push('Field titles must be unique.');
  }

  for (const field of fields) {
    if (!field.title.trim()) {
      errors.push(`Field ${field.id} needs a title.`);
    }

    if (field.type === 'category' || field.type === 'multicategory') {
      if (field.options.length === 0) {
        errors.push(`"${fieldLabel(field)}" needs at least one option.`);
      } else if (field.options.some((o) => !o.name.trim())) {
        errors.push(`"${fieldLabel(field)}" has an option with no name.`);
      }
    }

    if (field.type === 'number') {
      if (field.min != null && field.max != null && field.min > field.max) {
        errors.push(`"${fieldLabel(field)}" has a min greater than its max.`);
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
