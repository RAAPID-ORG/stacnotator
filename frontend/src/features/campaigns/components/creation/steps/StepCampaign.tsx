import type { CampaignCreate } from '~/api/client';
import { Input } from '~/shared/ui/forms';
export const StepCampaign = ({
  form,
  setForm,
}: {
  form: CampaignCreate;
  setForm: (f: CampaignCreate) => void;
}) => {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <p className="text-sm text-neutral-700">Give your campaign a clear, human-readable name.</p>

        <Input
          placeholder="Your campaign name…"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-neutral-900">Campaign Mode</p>

        <div className="space-y-3">
          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="tasks"
              checked={form.mode === 'tasks'}
              onChange={(e) => setForm({ ...form, mode: e.target.value as 'tasks' | 'open' })}
              className="mt-1 text-brand-700 focus:ring-brand-600"
            />
            <div className="flex-1">
              <div className="font-medium text-sm text-neutral-900">Tasks</div>
              <div className="text-sm text-neutral-600">
                Predefined list of sampled locations that should be annotated.
              </div>
            </div>
          </label>

          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="open"
              checked={form.mode === 'open'}
              onChange={(e) => setForm({ ...form, mode: e.target.value as 'tasks' | 'open' })}
              className="mt-1 text-brand-700 focus:ring-brand-600"
            />
            <div className="flex-1">
              <div className="font-medium text-sm text-neutral-900">Open</div>
              <div className="text-sm text-neutral-600">
                Imagery that can be navigated open-world like and annotations such as polygons can
                be placed manually.
              </div>
            </div>
          </label>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-neutral-900">Visibility</p>
        <label className="flex items-start space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_public ?? false}
            onChange={(e) => setForm({ ...form, is_public: e.target.checked })}
            className="mt-1 text-brand-700 focus:ring-brand-600"
          />
          <div className="flex-1">
            <div className="font-medium text-sm text-neutral-900">Public campaign</div>
            <div className="text-sm text-neutral-600">
              Anyone can view and add annotations to this campaign. Users can only edit or delete
              their own annotations. Task assignment is still restricted to campaign members.
            </div>
          </div>
        </label>
      </div>
    </div>
  );
};
