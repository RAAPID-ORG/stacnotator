import type { CampaignCreate } from '~/api/client';
import type { ImageryStepState } from '../../imagery/types';
import { emptyView, DEFAULT_BASEMAPS } from '../../imagery/types';
import { ImagerySetup } from '../../imagery/ImagerySetup';
import { useDraftController } from '../../imagery/controller';
import { syncToForm } from '../../imagery/draftSync';

export const createInitialImageryState = (): ImageryStepState => {
  const initialView = emptyView();
  initialView.name = 'View 1';
  return {
    sources: [],
    views: [initialView],
    basemaps: [...DEFAULT_BASEMAPS],
  };
};

export const StepImagery = ({
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

  return <ImagerySetup controller={controller} sections="sources-only" />;
};
