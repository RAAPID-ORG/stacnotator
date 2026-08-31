import { useMemo } from 'react';
import type { CampaignCreate } from '~/api/client';
import type { ImageryStepState } from '../../imagery/types';
import { DEFAULT_BASEMAPS } from '../../imagery/types';
import { ImagerySetup } from '../../imagery/ImagerySetup';
import { useDraftController } from '../../imagery/controller';
import { syncToForm } from '../../imagery/draftSync';

export const createInitialImageryState = (): ImageryStepState => ({
  sources: [],
  basemaps: [...DEFAULT_BASEMAPS],
});

export const StepImagery = ({
  projectId,
  form,
  setForm,
  imageryState,
  setImageryState,
}: {
  projectId: number;
  form: CampaignCreate;
  setForm: (f: CampaignCreate) => void;
  imageryState: ImageryStepState;
  setImageryState: (s: ImageryStepState) => void;
}) => {
  const settings = form.settings;
  // The area is picked one step earlier, so imagery searches can already be bound by it.
  const campaignBbox = useMemo(
    () =>
      settings
        ? [settings.bbox_west, settings.bbox_south, settings.bbox_east, settings.bbox_north]
        : null,
    [settings]
  );

  const controller = useDraftController({
    projectId,
    campaignBbox,
    state: imageryState,
    setState: (next) => {
      setImageryState(next);
      syncToForm(next, form, setForm);
    },
  });

  return <ImagerySetup controller={controller} />;
};
