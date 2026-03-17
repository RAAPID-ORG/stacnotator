import { useState, useMemo } from 'react';
import type { CampaignCreate } from '~/api/client';
import {
  validateFullForm,
  type FullValidationResult,
} from '~/features/campaigns/utils/campaignValidation';
import { StepCampaign } from './steps/StepCampaign';
import { StepSettings } from './steps/StepSettings';
import { StepImagery, createInitialImageryState } from './steps/StepImagery';
import { StepAddTimeseries } from './steps/StepAddTimeseries';
import { StepReview } from './steps/StepReview';
import { StepIndicator } from './StepIndicator';
import type { ImageryStepState } from './steps/imagery/types';

// Define step configuration to keep step names and content aligned
const STEP_CONFIG = {
  tasks: [
    { name: 'Campaign', component: 'StepCampaign' },
    { name: 'Settings', component: 'StepSettings' },
    { name: 'Imagery', component: 'StepImagery' },
    { name: 'Time Series', component: 'StepAddTimeseries' },
    { name: 'Create', component: 'StepReview' },
  ],
  open: [
    { name: 'Campaign', component: 'StepCampaign' },
    { name: 'Settings', component: 'StepSettings' },
    { name: 'Imagery', component: 'StepImagery' },
    { name: 'Time Series', component: 'StepAddTimeseries' },
    { name: 'Create', component: 'StepReview' },
  ],
} as const;

export { STEP_CONFIG };

export const CreateCampaignModal = ({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (data: CampaignCreate) => Promise<void>;
}) => {
  const [step, setStep] = useState(1);
  const [showValidation, setShowValidation] = useState(false);

  const [form, setForm] = useState<CampaignCreate>({
    name: '',
    settings: {
      labels: [],
      bbox_west: -17.5, // Western edge of Africa
      bbox_south: -35.0, // Southern edge of Africa
      bbox_east: 51.5, // Eastern edge of Africa
      bbox_north: 37.5, // Northern edge of Africa
    },
    imagery_configs: [],
    timeseries_configs: [],
    mode: 'tasks',
  });

  const [imageryState, setImageryState] = useState<ImageryStepState>(createInitialImageryState);

  // Live validation - recomputed whenever form changes
  const validation: FullValidationResult = useMemo(() => validateFullForm(form, imageryState), [form, imageryState]);

  // Total number of individual issues
  const totalErrors = useMemo(
    () =>
      Object.keys(validation.campaign.errors).length +
      Object.keys(validation.settings.errors).length +
      Object.keys(validation.imagery.errors).length +
      Object.keys(validation.timeseries.errors).length,
    [validation]
  );

  // Get current step configuration based on mode
  const currentStepConfig = STEP_CONFIG[form.mode as 'tasks' | 'open'];
  const totalSteps = currentStepConfig.length;

  // Render step content based on configuration
  const getStepContent = () => {
    const stepIndex = step - 1; // Convert to 0-based index
    const stepComponent = currentStepConfig[stepIndex]?.component;

    switch (stepComponent) {
      case 'StepCampaign':
        return <StepCampaign form={form} setForm={setForm} />;
      case 'StepSettings':
        return <StepSettings form={form} setForm={setForm} />;
      case 'StepImagery':
        return <StepImagery form={form} setForm={setForm} imageryState={imageryState} setImageryState={setImageryState} />;
      case 'StepAddTimeseries':
        return <StepAddTimeseries form={form} setForm={setForm} />;
      case 'StepReview':
        return <StepReview form={form} validation={validation} />;
      default:
        return null;
    }
  };

  const handleSubmit = () => {
    setShowValidation(true);

    if (!validation.isValid) {
      return;
    }

    console.log('[Campaign Create] full payload:', {
      form,
      imagery_editor_state: {
        sources: imageryState.sources,
        views: imageryState.views,
        basemaps: imageryState.basemaps,
      },
    });
    onSubmit(form);
  };

  return (
    <div className="fixed inset-0 z-50 bg-neutral-900/40 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-brand-700 flex justify-between items-center shrink-0">
          <h2 className="text-lg font-semibold text-neutral-900">New Campaign</h2>
          <button
            onClick={onClose}
            className="text-neutral-700 hover:text-neutral-900 cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        <StepIndicator step={step} mode={form.mode as 'tasks' | 'open'} onStepClick={setStep} />

        <div className="p-6 overflow-y-auto h-[60vh]">{getStepContent()}</div>

        <div className="px-6 py-4 border-t border-brand-500 flex justify-between shrink-0">
          <button
            onClick={step === 1 ? onClose : () => setStep(step - 1)}
            className="text-sm text-neutral-700 hover:text-neutral-900 transition-colors cursor-pointer"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>

          {step < totalSteps ? (
            <button
              onClick={() => setStep(step + 1)}
              className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 transition-colors cursor-pointer"
            >
              Continue
            </button>
          ) : (
            <div className="relative group">
              <button
                onClick={handleSubmit}
                disabled={showValidation && !validation.isValid}
                className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors cursor-pointer disabled:bg-neutral-300 disabled:text-neutral-500 disabled:cursor-not-allowed"
              >
                Create Campaign
              </button>
              {showValidation && !validation.isValid && (
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 text-xs text-white bg-neutral-800 rounded shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  Fix {totalErrors} issue{totalErrors !== 1 ? 's' : ''} to continue
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
