import type { CampaignCreate } from '~/api/client';
import { Field, Input } from '~/shared/ui/forms';

export const StepCampaign = ({
  form,
  setForm,
}: {
  form: CampaignCreate;
  setForm: (f: CampaignCreate) => void;
}) => (
  <Field
    label="Campaign name"
    hint="Pick a name that a colleague would recognise months from now - e.g. “Malawi maize 2024” rather than “test 3”."
    htmlFor="campaign-name"
    required
  >
    <Input
      id="campaign-name"
      placeholder="Your campaign name…"
      value={form.name}
      onChange={(e) => setForm({ ...form, name: e.target.value })}
    />
  </Field>
);
