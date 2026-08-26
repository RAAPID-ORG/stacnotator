import type { CampaignCreate, CampaignSettingsCreate } from '~/api/client';
import { BoundingBoxEditor } from '../../BoundingBoxEditor';
import { FormFieldsEditor } from '../../FormFieldsEditor';
import { LabelsEditor } from '../../LabelsEditor';
import { Select } from '~/shared/ui/forms';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 2016 }, (_, i) => CURRENT_YEAR - i);

const emptySettings = (): CampaignSettingsCreate => ({
  labels: [],
  bbox_west: 0,
  bbox_south: 0,
  bbox_east: 0,
  bbox_north: 0,
  embedding_year: null,
});
export const StepSettings = ({
  form,
  setForm,
}: {
  form: CampaignCreate;
  setForm: (f: CampaignCreate) => void;
}) => {
  const s = form.settings ?? emptySettings();

  const updateSettings = <K extends keyof CampaignSettingsCreate>(
    key: K,
    value: CampaignSettingsCreate[K]
  ) => {
    setForm({
      ...form,
      settings: {
        ...s,
        [key]: value,
      },
    });
  };

  return (
    <div className="space-y-6">
      <BoundingBoxEditor
        value={s}
        onChange={(updates) => {
          setForm({
            ...form,
            settings: {
              ...s,
              ...updates,
            },
          });
        }}
      />

      <div>
        <h3 className="text-sm font-medium text-neutral-900 mb-1">Labels</h3>
        <p className="text-xs text-neutral-500 mb-1">
          A label is what a shape <em>is</em> - the class an annotator picks after drawing it. Each
          annotation carries exactly one. The geometry type decides what gets drawn for that label,
          and every label is given an ID automatically, in the order you add them here.
        </p>
        <p className="text-xs text-neutral-400 mb-3">
          <span className="font-medium">Example:</span> for a crop survey - Maize, Cassava, Fallow,
          Water, each as a polygon; Farm building as a point.
        </p>
        <LabelsEditor
          value={s.labels}
          onChange={(labels) => updateSettings('labels', labels)}
          showGeometryType
        />
      </div>

      <div>
        <h3 className="text-sm font-medium text-neutral-900 mb-1">
          Custom form fields
          <span className="ml-1 text-xs font-normal text-neutral-400">(optional)</span>
        </h3>
        <p className="text-xs text-neutral-500 mb-1">
          Extra questions asked about a single annotation, on top of its label. Use them for what
          varies <em>within</em> a class - if the answer decides what the shape is, it belongs in
          the labels above instead.
        </p>
        <p className="text-xs text-neutral-500 mb-1">
          Annotators see them right where they label: in explorative labelling the questions appear
          once a shape has been drawn, and in task mode they sit beside the task with the label
          list. A field marked required has to be answered before the annotation can be saved.
        </p>
        <p className="text-xs text-neutral-400 mb-3">
          <span className="font-medium">Example:</span> having drawn a Maize field - “Crop stage?”
          (seedling / mature / harvested), “Field size in ha?”, “Anything unusual here?”.
        </p>
        <FormFieldsEditor
          value={s.form_fields ?? []}
          onChange={(form_fields) => updateSettings('form_fields', form_fields)}
        />
      </div>

      {/* Embedding Year (optional) */}
      <div>
        <h3 className="text-sm font-medium text-neutral-900 mb-1">
          Satellite Embedding Year
          <span className="ml-1 text-xs font-normal text-neutral-400">(optional)</span>
        </h3>
        <p className="text-xs text-neutral-500 mb-3">
          If set, satellite embeddings will be fetched for the chosen year to enable KNN-based label
          validation during annotation. If not set, the validation feature will be unavailable.
        </p>
        <div className="w-48">
          <Select
            value={s.embedding_year ?? ''}
            onChange={(e) =>
              updateSettings('embedding_year', e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">None (validation disabled)</option>
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
};
