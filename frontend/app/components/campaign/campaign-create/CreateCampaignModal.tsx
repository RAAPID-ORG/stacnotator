import { useState } from 'react';
import { StepIndicator } from '~/components/campaign/campaign-create/StepIndicator';

import { StepCampaign } from '~/components/campaign/campaign-create/steps/StepCampaign';
import { StepSettings } from '~/components/campaign/campaign-create/steps/StepSettings';
import { StepImagery } from '~/components/campaign/campaign-create/steps/StepImagery';
import { StepReview } from '~/components/campaign/campaign-create/steps/StepReview';
import { StepAddAnnotationTasks } from '~/components/campaign/campaign-create/steps/StepAddAnnotationTasks';
import type { CampaignCreate } from '~/api/client';
import { StepAddTimeseries } from './steps/StepAddTimeseries';

// Define step configuration to keep step names and content aligned
const STEP_CONFIG = {
  tasks: [
    { name: 'Campaign', component: 'StepCampaign' },
    { name: 'Settings', component: 'StepSettings' },
    { name: 'Imagery', component: 'StepImagery' },
    { name: 'Time Series', component: 'StepAddTimeseries' },
    { name: 'Tasks', component: 'StepAddAnnotationTasks' },
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
  onSubmit: (data: CampaignCreate, taskIngestionFile: File | null) => Promise<void>;
}) => {
  const [step, setStep] = useState(1);

  const [taskIngestionFile, setTaskIngestionFile] = useState<File | null>(null);
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
        return <StepImagery form={form} setForm={setForm} />;
      case 'StepAddTimeseries':
        return <StepAddTimeseries form={form} setForm={setForm} />;
      case 'StepAddAnnotationTasks':
        return <StepAddAnnotationTasks file={taskIngestionFile} setFile={setTaskIngestionFile} />;
      case 'StepReview':
        return <StepReview form={form} />;
      default:
        return null;
    }
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

        <StepIndicator step={step} mode={form.mode as 'tasks' | 'open'} />

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
            <button
              onClick={() => onSubmit(form, taskIngestionFile)}
              className="rounded-md bg-green-500 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 transition-colors cursor-pointer"
            >
              Create Campaign
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
