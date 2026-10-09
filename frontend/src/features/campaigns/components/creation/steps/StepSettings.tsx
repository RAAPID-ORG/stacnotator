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
        <h3 className="section-heading">Annotation class names</h3>
        <p className="section-description mb-1">
          Define the different classes that annotators can assign to shapes / that they can choose from when labeling.
        </p>
        <p className="text-xs text-neutral-400 mb-3">
          <span className="font-medium">Example:</span> For a crop survey you might want to identify
          all fields with Maize, Cassava or Fallow, aswell as Farms. These would be your class names. 
          You only need to select a geometry type for each class if you are planning on allowing users to draw the shapes of these.
          In our case, you would select polygon as the geometry types for the 3 field types and might want to select point for a farm.
        </p>
        <LabelsEditor
          value={s.labels}
          onChange={(labels) => updateSettings('labels', labels)}
          showGeometryType
        />
      </div>

      <div>
        <h3 className="section-heading">
          Additional form questions
          <span className="ml-1 text-xs font-normal text-neutral-400">(optional)</span>
        </h3>
        <p className="section-description mb-1">
          Add extra questions for annotations. These allow you to capture additional details beyond the main class label.
        </p>
        <p className="text-xs text-neutral-400 mb-3">
          <span className="font-medium">Example:</span> If you just drew a Maize field you might
          want to distinguish the crop stage of the fields. So you could specify a “Crop stage?”
          custom field with <em>“Crop stage?”</em> and <em>“Seedling / Mature / Harvested”</em> as options.
        </p>
        <FormFieldsEditor
          value={s.form_fields ?? []}
          onChange={(form_fields) => updateSettings('form_fields', form_fields)}
        />
      </div>

      {/* Embedding Year (optional) */}
      <div>
        <h3 className="section-heading">
          Satellite embedding year
          <span className="ml-1 text-xs font-normal text-neutral-400">(optional)</span>
        </h3>
        <p className="section-description mb-3">
          Experimental. If set, satellite embeddings are fetched for the chosen year to enable
          KNN-based label validation during annotation: a new label is checked against the
          embeddings of every existing one. Leave it at None unless you plan to use this.
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
