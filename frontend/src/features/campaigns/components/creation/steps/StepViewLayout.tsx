import type { CampaignCreate } from '~/api/client';
import type { ImageryStepState } from '../../imagery/types';
import { ImagerySetup } from '../../imagery/ImagerySetup';
import { useDraftController } from '../../imagery/controller';
import { syncToForm } from '../../imagery/draftSync';

export const StepViewLayout = ({
  form,
  setForm,
  imageryState,
  setImageryState,
}: {
  form: CampaignCreate;
  setForm: (f: CampaignCreate) => void;
  imageryState: ImageryStepState;
  setImageryState: (s: ImageryStepState) => void;
}) => {
  const controller = useDraftController({
    state: imageryState,
    setState: (next) => {
      setImageryState(next);
      syncToForm(next, form, setForm);
    },
  });

  return <ImagerySetup controller={controller} sections="view-layout-only" />;
};
