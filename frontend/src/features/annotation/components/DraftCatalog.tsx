import { capitalizeFirst } from '~/shared/utils/utility';
import type { ExtendedLabel } from '../utils/labelMetadata';
import type { FormField, FormValues } from '../utils/formValues';
import { AnnotationForm } from './AnnotationForm';

interface DraftCatalogProps {
  /** Label the draft was drawn with (null only if it was somehow removed). */
  label: ExtendedLabel | null;
  fields: FormField[];
  values: FormValues;
  activeFieldIndex: number | null;
  onChange: (next: FormValues) => void;
  /** Persist the draft. Kept async so the button can reflect the save state. */
  onSave: () => Promise<boolean> | void;
  /** Drop the draft without saving. */
  onDiscard: () => void;
  saving: boolean;
}

/**
 * The questions catalog shown in place of the label list once a geometry has
 * been drawn in open mode. It captures the custom-field answers for that single
 * geometry; saving (Enter / the button / drawing the next shape) persists the
 * annotation, the x discards it.
 */
export const DraftCatalog: React.FC<DraftCatalogProps> = ({
  label,
  fields,
  values,
  activeFieldIndex,
  onChange,
  onSave,
  onDiscard,
  saving,
}) => {
  const noun = label?.geometry_type ?? 'polygon';

  return (
    <div data-testid="draft-catalog" className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-neutral-700 text-xs tracking-wide">
          {label ? capitalizeFirst(label.name) : 'Annotation'} - answer questions
        </span>
        <button
          type="button"
          data-testid="draft-discard"
          onClick={onDiscard}
          title="Discard this annotation (Esc keeps it)"
          className="flex-shrink-0 p-1 rounded text-neutral-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer transition-colors"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap border-t border-l border-neutral-100 rounded">
        <AnnotationForm
          fields={fields}
          values={values}
          onChange={onChange}
          activeFieldIndex={activeFieldIndex}
        />
      </div>

      <button
        type="button"
        data-testid="draft-save"
        onClick={() => void onSave()}
        disabled={saving}
        className="w-full px-2.5 py-1.5 rounded text-[11px] font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors"
      >
        Save annotation (Enter)
      </button>
      <p className="text-[11px] text-neutral-500">Drawing another {noun} saves this one too.</p>
    </div>
  );
};

export default DraftCatalog;
