import { useState, useMemo, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { CampaignCreate, ProjectOut, ProjectUserOut } from '~/api/client';
import { createCampaign, getProject, getProjectUsers } from '~/api/client';
import {
  DEFAULT_LABELLING_POLICY,
  withAnyoneSeeded,
} from '~/features/campaigns/utils/labellingPolicy';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useProjectIdParam } from '~/shared/hooks/useProjectIdParam';
import { campaignPath, projectPath, projectsPath } from '~/app/routes';
import { SkeletonForm, SkeletonPage } from '~/shared/ui/Skeleton';
import {
  validateFullForm,
  type FullValidationResult,
} from '~/features/campaigns/utils/campaignValidation';
import { StepCampaign } from '../components/creation/steps/StepCampaign';
import { StepSettings } from '../components/creation/steps/StepSettings';
import { StepImagery, createInitialImageryState } from '../components/creation/steps/StepImagery';
import { StepViewLayout } from '../components/creation/steps/StepViewLayout';
import { StepAddTimeseries } from '../components/creation/steps/StepAddTimeseries';
import { StepReview } from '../components/creation/steps/StepReview';
import { StepIndicator } from '../components/creation/StepIndicator';
import type { ImageryStepState } from '../components/imagery/types';
import { Button } from '~/shared/ui/forms';
import { FadeIn } from '~/shared/ui/motion';
import { handleError } from '~/shared/utils/errorHandler';

export const CreateCampaignPage = () => {
  const navigate = useNavigate();
  const projectId = useProjectIdParam();
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const showLoadingOverlay = useLayoutStore((s) => s.showLoadingOverlay);
  const hideLoadingOverlay = useLayoutStore((s) => s.hideLoadingOverlay);

  useEffect(() => {
    setBreadcrumbs([
      { label: 'Projects', path: projectsPath() },
      { label: 'Project', path: projectPath(projectId) },
      { label: 'New Campaign' },
    ]);
  }, [projectId, setBreadcrumbs]);

  const [step, setStep] = useState(1);
  const [showValidation, setShowValidation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [project, setProject] = useState<ProjectOut | null>(null);
  const [projectUsers, setProjectUsers] = useState<ProjectUserOut[]>([]);
  const [loadingProject, setLoadingProject] = useState(true);

  const [form, setForm] = useState<CampaignCreate>({
    name: '',
    project_id: projectId,
    settings: {
      labels: [],
      bbox_west: -17.5,
      bbox_south: -35.0,
      bbox_east: 51.5,
      bbox_north: 37.5,
    },
    imagery_editor_state: null,
    timeseries_configs: [],
    labelling_policy: DEFAULT_LABELLING_POLICY,
  });

  // Runs before the wizard is interactive (a skeleton covers the load), so
  // seeding the policy here can't overwrite anything the user picked.
  useEffect(() => {
    const loadProject = async () => {
      try {
        setLoadingProject(true);
        const [projectRes, usersRes] = await Promise.all([
          getProject({ path: { project_id: projectId } }),
          getProjectUsers({ path: { project_id: projectId } }),
        ]);
        setProject(projectRes.data ?? null);
        setProjectUsers(usersRes.data?.users ?? []);
        if (projectRes.data?.is_public) {
          setForm((current) => ({
            ...current,
            labelling_policy: withAnyoneSeeded(
              current.labelling_policy ?? DEFAULT_LABELLING_POLICY
            ),
          }));
        }
      } catch (err) {
        handleError(err, 'Failed to load project');
      } finally {
        setLoadingProject(false);
      }
    };

    loadProject();
  }, [projectId]);

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

  const currentStepConfig = [
    { name: 'Campaign', component: 'StepCampaign' },
    { name: 'Settings', component: 'StepSettings' },
    { name: 'Imagery', component: 'StepImagery' },
    { name: 'Annotation Views', component: 'StepViewLayout' },
    { name: 'Time Series', component: 'StepAddTimeseries' },
    { name: 'Create', component: 'StepReview' },
  ] as const;

  const totalSteps = currentStepConfig.length;

  const getStepContent = () => {
    const stepComponent = currentStepConfig[step - 1]?.component;
    switch (stepComponent) {
      case 'StepCampaign':
        return (
          <StepCampaign
            form={form}
            setForm={setForm}
            projectIsPublic={project?.is_public ?? false}
            members={projectUsers}
          />
        );
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
      case 'StepViewLayout':
        return (
          <StepViewLayout
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
    if (isSubmitting) return;
    setShowValidation(true);
    if (!validation.isValid) return;

    setIsSubmitting(true);
    try {
      showLoadingOverlay('Creating campaign...');
      const { data: campaign } = await createCampaign({ body: form });
      if (campaign?.registration_status === 'registering') {
        showAlert('Campaign created. Mosaic registration is running in the background...', 'info');
      } else {
        showAlert('Campaign created successfully', 'success');
      }
      if (campaign) {
        navigate(campaignPath(campaign.project_id, campaign.id, 'settings'));
      } else {
        navigate(projectPath(projectId));
      }
    } catch (err) {
      handleError(err, 'Failed to create campaign');
    } finally {
      hideLoadingOverlay();
      setIsSubmitting(false);
    }
  };

  if (loadingProject) {
    return (
      <SkeletonPage>
        <SkeletonForm sections={3} />
      </SkeletonPage>
    );
  }

  // Only project admins may add campaigns to a project.
  if (!project?.is_admin) {
    return <Navigate to={projectPath(projectId)} replace />;
  }

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
          <StepIndicator step={step} onStepClick={setStep} />
        </div>

        <div className="surface">
          <div className="p-6">{getStepContent()}</div>
        </div>

        <div className="flex items-center justify-between mt-6 pb-8">
          <Button
            variant="secondary"
            disabled={isSubmitting}
            onClick={step === 1 ? () => navigate(projectPath(projectId)) : () => setStep(step - 1)}
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>

          {step < totalSteps ? (
            <Button onClick={() => setStep(step + 1)}>Continue</Button>
          ) : (
            <div className="relative group">
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || (showValidation && !validation.isValid)}
              >
                {isSubmitting ? 'Creating...' : 'Create campaign'}
              </Button>
              {showValidation && !validation.isValid && !isSubmitting && (
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
