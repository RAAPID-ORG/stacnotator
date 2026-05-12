import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CampaignCreate } from '~/api/client';
import { createCampaign } from '~/api/client';
import { useLayoutStore } from '~/features/layout/layout.store';
import {
  validateFullForm,
  type FullValidationResult,
} from '~/features/campaigns/utils/campaignValidation';
import { StepCampaign } from '../components/creation/steps/StepCampaign';
import { StepSettings } from '../components/creation/steps/StepSettings';
import { StepImagery, createInitialImageryState } from '../components/creation/steps/StepImagery';
import { StepAddTimeseries } from '../components/creation/steps/StepAddTimeseries';
import { StepReview } from '../components/creation/steps/StepReview';
import { StepIndicator } from '../components/creation/StepIndicator';
import type { ImageryStepState } from '../components/creation/steps/imagery/types';
import { Button } from '~/shared/ui/forms';
import { FadeIn } from '~/shared/ui/motion';
import { handleError } from '~/shared/utils/errorHandler';

export const CreateCampaignPage = () => {
  const navigate = useNavigate();
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const showLoadingOverlay = useLayoutStore((s) => s.showLoadingOverlay);
  const hideLoadingOverlay = useLayoutStore((s) => s.hideLoadingOverlay);

  useEffect(() => {
    setBreadcrumbs([{ label: 'Campaigns', path: '/campaigns' }, { label: 'New Campaign' }]);
  }, [setBreadcrumbs]);

  const [step, setStep] = useState(1);
  const [showValidation, setShowValidation] = useState(false);

  const [form, setForm] = useState<CampaignCreate>({
    name: '',
    settings: {
      labels: [],
      bbox_west: -17.5,
      bbox_south: -35.0,
      bbox_east: 51.5,
      bbox_north: 37.5,
    },
    imagery_editor_state: null,
    timeseries_configs: [],
    mode: 'tasks',
  });

  const [imageryState, setImageryState] = useState<ImageryStepState>(createInitialImageryState);

  const validation: FullValidationResult = useMemo(
    () => validateFullForm(form, imageryState),
    [form, imageryState]
  );

  const totalErrors = useMemo(
    () =>
      Object.keys(validation.campaign.errors).length +
      Object.keys(validation.settings.errors).length +
      Object.keys(validation.imagery.errors).length +
      Object.keys(validation.timeseries.errors).length,
    [validation]
  );

  const currentStepConfig =
    form.mode === 'tasks' || form.mode === 'open'
      ? ([
          { name: 'Campaign', component: 'StepCampaign' },
          { name: 'Settings', component: 'StepSettings' },
          { name: 'Imagery', component: 'StepImagery' },
          { name: 'Time Series', component: 'StepAddTimeseries' },
          { name: 'Create', component: 'StepReview' },
        ] as const)
      : ([
          { name: 'Campaign', component: 'StepCampaign' },
          { name: 'Settings', component: 'StepSettings' },
          { name: 'Imagery', component: 'StepImagery' },
          { name: 'Time Series', component: 'StepAddTimeseries' },
          { name: 'Create', component: 'StepReview' },
        ] as const);

  const totalSteps = currentStepConfig.length;

  const getStepContent = () => {
    const stepComponent = currentStepConfig[step - 1]?.component;
    switch (stepComponent) {
      case 'StepCampaign':
        return <StepCampaign form={form} setForm={setForm} />;
      case 'StepSettings':
        return <StepSettings form={form} setForm={setForm} />;
      case 'StepImagery':
        return (
          <StepImagery
            form={form}
            setForm={setForm}
            imageryState={imageryState}
            setImageryState={setImageryState}
          />
        );
      case 'StepAddTimeseries':
        return <StepAddTimeseries form={form} setForm={setForm} />;
      case 'StepReview':
        return <StepReview form={form} validation={validation} />;
      default:
        return null;
    }
  };

  const handleSubmit = async () => {
    setShowValidation(true);
    if (!validation.isValid) return;

    try {
      showLoadingOverlay('Creating campaign...');
      const { data: campaign } = await createCampaign({ body: form });
      const status = (campaign as Record<string, unknown>)?.registration_status;
      if (status === 'registering') {
        showAlert('Campaign created. Mosaic registration is running in the background...', 'info');
      } else {
        showAlert('Campaign created successfully', 'success');
      }
      if (campaign) {
        navigate(`/campaigns/${(campaign as Record<string, unknown>).id}/settings`);
      } else {
        navigate('/campaigns');
      }
    } catch (err) {
      handleError(err, 'Failed to create campaign');
    } finally {
      hideLoadingOverlay();
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">New campaign</h1>
            <p className="page-subtitle">
              Set up your campaign step by step - details, settings, imagery, and more.
            </p>
          </div>
        </header>

        <div className="mb-6">
          <StepIndicator step={step} mode={form.mode as 'tasks' | 'open'} onStepClick={setStep} />
        </div>

        <div className="surface">
          <div className="p-6">{getStepContent()}</div>
        </div>

        <div className="flex items-center justify-between mt-6 pb-8">
          <Button
            variant="secondary"
            onClick={step === 1 ? () => navigate('/campaigns') : () => setStep(step - 1)}
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>

          {step < totalSteps ? (
            <Button onClick={() => setStep(step + 1)}>Continue</Button>
          ) : (
            <div className="relative group">
              <Button onClick={handleSubmit} disabled={showValidation && !validation.isValid}>
                Create campaign
              </Button>
              {showValidation && !validation.isValid && (
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 text-xs text-white bg-neutral-800 rounded-md shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  Fix {totalErrors} issue{totalErrors !== 1 ? 's' : ''} to continue
                </span>
              )}
            </div>
          )}
        </div>
      </FadeIn>
    </div>
  );
};
