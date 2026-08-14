import { capitalizeFirst } from '~/shared/utils/utility';
import type { FormField, FormValues } from '../../campaign/annotation';
import type { ExtendedLabel } from '../../campaign/annotation';
import { FormFields } from '../../components/FormFields';

export interface DraftCatalogProps {
  label: ExtendedLabel | null;
  fields: FormField[];
  values: FormValues;
  activeFieldIndex: number | null;
  onChange: (next: FormValues) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  error?: string | null;
}

export function DraftCatalog({
  label,
  fields,
  values,
  activeFieldIndex,
  onChange,
  onSave,
  onClose,
  saving,
  error = null,
}: DraftCatalogProps) {
  const noun = label?.geometry_type ?? 'polygon';

  return (
    <div data-testid="draft-catalog" className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-neutral-700 text-xs tracking-wide">
          {label ? capitalizeFirst(label.name) : 'Annotation'} - answer questions
        </span>
        <button
          type="button"
          data-testid="draft-close"
          onClick={onClose}
          title="Close (unanswered required fields discard the annotation)"
          className="flex-shrink-0 px-1.5 py-0.5 rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 cursor-pointer transition-colors"
        >
          ✕
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
          {error}
        </p>
      )}

      <div className="flex flex-wrap border-t border-l border-neutral-100 rounded">
        <FormFields
          fields={fields}
          values={values}
          onChange={onChange}
          activeFieldIndex={activeFieldIndex}
          disabled={saving}
        />
      </div>

      <button
        type="button"
        data-testid="draft-save"
        onClick={onSave}
        disabled={saving}
        className="w-full px-2.5 py-1.5 rounded text-[11px] font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors"
      >
        {error ? 'Retry save (Enter)' : 'Save annotation (Enter)'}
      </button>
      <p className="text-[11px] text-neutral-500">Drawing another {noun} saves this one too.</p>
    </div>
  );
}
