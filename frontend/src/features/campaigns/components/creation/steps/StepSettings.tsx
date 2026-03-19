import type { CampaignCreate, CampaignSettingsCreate } from '~/api/client';
import { BoundingBoxEditor } from '../../BoundingBoxEditor';
import { LabelsEditor } from '../../LabelsEditor';

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
        <p className="text-xs text-neutral-500 mb-3">
          The class names annotators will choose from when labeling. Each label is assigned an ID
          automatically in the order you add them.
          {form.mode === 'open' &&
            ' For open mode, you can also specify the geometry type per label.'}
        </p>
        <LabelsEditor
          value={s.labels}
          onChange={(labels) => updateSettings('labels', labels)}
          showGeometryType={form.mode === 'open'}
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
        <select
          value={s.embedding_year ?? ''}
          onChange={(e) =>
            updateSettings('embedding_year', e.target.value ? Number(e.target.value) : null)
          }
          className="w-48 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">None (validation disabled)</option>
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
