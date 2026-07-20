import { useState } from 'react';
import type { AnnotationOut } from '~/api/client';
import { capitalizeFirst } from '~/shared/utils/utility';
import { labelsWithSameGeometry, type ExtendedLabel } from '../utils/labelMetadata';
import { formValuesEqual, type FormField, type FormValues } from '../utils/formValues';
import { AnnotationForm } from './AnnotationForm';

interface EditDetailsEditorProps {
  annotation: AnnotationOut;
  labels: ExtendedLabel[];
  fields: FormField[];
  onSave: (
    annotationId: number,
    meta: { labelId: number; formValues: FormValues }
  ) => Promise<boolean> | void;
  saving: boolean;
}

/**
 * Edit an existing annotation's label and answers in the open-mode edit panel.
 * The label is restricted to the same geometry type since the geometry is
 * unchanged here. Mount with a per-id key so its state resets per annotation.
 */
export const EditDetailsEditor: React.FC<EditDetailsEditorProps> = ({
  annotation,
  labels,
  fields,
  onSave,
  saving,
}) => {
  const [labelId, setLabelId] = useState<number | null>(annotation.label_id);
  const [values, setValues] = useState<FormValues>(annotation.form_values ?? {});

  const selectable = labelsWithSameGeometry(labels, annotation.label_id);

  if (fields.length === 0 && selectable.length <= 1) return null;

  const dirty =
    labelId !== annotation.label_id || !formValuesEqual(values, annotation.form_values ?? {});

  return (
    <div className="flex flex-col gap-2 pt-1">
      {selectable.length > 1 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide">
            Label
          </span>
          <div className="flex flex-wrap gap-1">
            {selectable.map((label) => {
              const selected = labelId === label.id;
              return (
                <button
                  key={label.id}
                  type="button"
                  onClick={() => setLabelId(label.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded border transition-colors cursor-pointer ${
                    selected
                      ? 'bg-brand-50 text-brand-700 border-brand-600 font-semibold'
                      : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-sm border"
                    style={{ backgroundColor: label.color, borderColor: label.color }}
                  />
                  {capitalizeFirst(label.name)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {fields.length > 0 && (
        <div className="flex flex-wrap border-t border-l border-neutral-100 rounded">
          <AnnotationForm
            fields={fields}
            values={values}
            onChange={setValues}
            activeFieldIndex={null}
          />
        </div>
      )}

      <button
        type="button"
        data-testid="edit-details-save"
        onClick={() =>
          labelId !== null && void onSave(annotation.id, { labelId, formValues: values })
        }
        disabled={saving || !dirty || labelId === null}
        className="self-start px-3 py-1.5 rounded text-[11px] font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
      >
        Save changes
      </button>
    </div>
  );
};

export default EditDetailsEditor;
