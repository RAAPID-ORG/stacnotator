import { useState } from 'react';
import { updateAnnotationOpenmode, type AnnotationOut } from '~/api/client';
import type { FormValues } from '../../campaign/annotation';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import {
  extendedLabels,
  formValuesEqual,
  labelsWithSameGeometry,
  validateForm,
} from '../../campaign/annotation';
import { useCampaign } from '../../stores/campaign';
import { useWorkStore } from '../../stores/work';
import { FormFields } from '../../components/FormFields';
import { LabelChips } from '../../components/LabelChips';

function DetailsForm({ annotation }: { annotation: AnnotationOut }) {
  const campaign = useCampaign();
  const [labelId, setLabelId] = useState<number | null>(annotation.label_id);
  const [values, setValues] = useState<FormValues>(annotation.form_values ?? {});
  const [flagComment, setFlagComment] = useState(annotation.flag_comment ?? '');
  const [saving, setSaving] = useState(false);
  const showAlert = useLayoutStore((s) => s.showAlert);

  const labels = extendedLabels(campaign);
  const selectable = labelsWithSameGeometry(labels, annotation.label_id);
  const fields = campaign.settings.form_fields ?? [];
  const dirty =
    labelId !== annotation.label_id || !formValuesEqual(values, annotation.form_values ?? {});

  const save = async () => {
    if (labelId === null) return;
    const { ok, missing } = validateForm(fields, values);
    if (!ok) {
      showAlert(`Missing required: ${missing.join(', ')}`, 'error');
      return;
    }
    setSaving(true);
    try {
      const result = await updateAnnotationOpenmode({
        path: { campaign_id: campaign.id, annotation_id: annotation.id },
        body: {
          label_id: labelId,
          comment: annotation.comment ?? null,
          geometry_wkt: null,
          is_authoritative: null,
          // Always the full answer set: {} would clear the stored answers,
          // and the backend re-checks required fields against the new label.
          form_values: values,
        },
      });
      // The shared session is what the geometry save will send back, so it
      // learns about this write immediately - server copy when there is one,
      // otherwise the fields we just wrote.
      useWorkStore
        .getState()
        .setEditAnnotation(
          result.data ?? { ...annotation, label_id: labelId, form_values: values }
        );
      useWorkStore.getState().bumpVersion();
      showAlert('Annotation updated successfully', 'success');
    } catch (error) {
      handleError(error, 'Could not update the annotation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 pt-2 border-t border-neutral-200">
      <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide">
        Selected annotation #{annotation.id}
      </span>

      {selectable.length > 1 && (
        <LabelChips
          labels={selectable}
          selectedId={labelId}
          onSelect={(label) => setLabelId(label.id)}
          disabled={saving}
          showIndex={false}
        />
      )}

      {fields.length > 0 && (
        <div className="flex flex-wrap border-t border-l border-neutral-100 rounded">
          <FormFields
            fields={fields}
            values={values}
            onChange={setValues}
            activeFieldIndex={null}
            disabled={saving}
          />
        </div>
      )}

      {(fields.length > 0 || selectable.length > 1) && (
        <button
          type="button"
          data-testid="edit-details-save"
          onClick={() => void save()}
          disabled={saving || !dirty || labelId === null}
          className="self-start px-3 py-1.5 rounded text-[11px] font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          Save changes
        </button>
      )}

      <label
        className="flex items-center gap-1.5 cursor-pointer select-none"
        title="Toggle flag-for-review on this annotation. Saves immediately. Press F to toggle."
      >
        <input
          type="checkbox"
          checked={annotation.flagged_for_review ?? false}
          onChange={(e) =>
            void useWorkStore
              .getState()
              .saveEditFlag(e.target.checked, e.target.checked ? flagComment || null : null)
          }
          className="w-3.5 h-3.5 rounded border-neutral-300 text-rose-600 focus:ring-rose-500"
        />
        <span
          className={`text-[11px] ${annotation.flagged_for_review ? 'text-rose-700 font-semibold' : 'text-neutral-600'}`}
        >
          Flag for review [F]
        </span>
      </label>

      {annotation.flagged_for_review && (
        <textarea
          value={flagComment}
          onChange={(e) => setFlagComment(e.target.value)}
          onBlur={() => {
            if ((annotation.flag_comment ?? '') !== flagComment) {
              void useWorkStore.getState().saveEditFlag(true, flagComment || null);
            }
          }}
          placeholder="Why are you flagging this? (optional)"
          rows={2}
          maxLength={5000}
          className="w-full resize-none px-2.5 py-2 text-xs text-neutral-900 bg-white border border-neutral-300 rounded-md focus:outline-none focus:border-brand-500"
        />
      )}
    </div>
  );
}

export function EditDetails() {
  const selection = useWorkStore((s) => s.selection);
  const annotation = useWorkStore((s) => s.edit?.annotation ?? null);

  // A box selection of many has no single record to edit; the overlay's
  // delete is what acts on those.
  if (selection.length !== 1 || !annotation || annotation.id !== selection[0]) return null;

  return <DetailsForm key={annotation.id} annotation={annotation} />;
}
