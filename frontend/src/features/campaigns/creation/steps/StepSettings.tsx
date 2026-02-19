import type { CampaignCreate, CampaignSettingsCreate } from '~/api/client';
import { BoundingBoxEditor } from '../../components/BoundingBoxEditor';
import { LabelsEditor } from '../../components/LabelsEditor';


const emptySettings = (): CampaignSettingsCreate => ({
  labels: [],
  bbox_west: 0,
  bbox_south: 0,
  bbox_east: 0,
  bbox_north: 0,
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
          The class names annotators will choose from when labeling. Each label is assigned an ID automatically in the order you add them.
        </p>
        <LabelsEditor value={s.labels} onChange={(labels) => updateSettings('labels', labels)} />
      </div>
    </div>
  );
};
