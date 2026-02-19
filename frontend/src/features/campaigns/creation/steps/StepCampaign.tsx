import type { CampaignCreate } from '~/api/client';
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

        <input
          className="w-full border-brand-500 border-b focus:border-b focus:border-b-2 outline-none focus:ring-0"
          placeholder="Your Campaign Name..."
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
              className="mt-1 text-brand-500 focus:ring-brand-500"
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
              className="mt-1 text-brand-500 focus:ring-brand-500"
            />
            <div className="flex-1">
              <div className="font-medium text-sm text-neutral-900">Open</div>
              <div className="text-sm text-neutral-600">
                Imagery that can be navigated open-world like and annotations can be placed
                manually.
              </div>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
};
