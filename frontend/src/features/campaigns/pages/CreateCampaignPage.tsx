import { useState, useMemo, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { CampaignCreate, ProjectUserOut } from '~/api/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCampaignMutation,
  getProjectOptions,
  getProjectUsersOptions,
  listProjectCampaignsQueryKey,
} from '~/api/queries';
import {
  DEFAULT_LABELLING_POLICY,
  withAnyoneSeeded,
} from '~/features/campaigns/utils/labellingPolicy';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useProjectIdParam } from '~/shared/hooks/useProjectIdParam';
import { campaignPath, projectPath, projectsPath } from '~/app/routes';
import { SkeletonForm } from '~/shared/ui/Skeleton';
import {
  validateFullForm,
  type FullValidationResult,
} from '~/features/campaigns/utils/campaignValidation';
import { StepCampaign } from '../components/creation/steps/StepCampaign';
import { StepSettings } from '../components/creation/steps/StepSettings';
import { StepImagery, createInitialImageryState } from '../components/creation/steps/StepImagery';
import { StepAddTimeseries } from '../components/creation/steps/StepAddTimeseries';
import { StepAccess } from '../components/creation/steps/StepAccess';
import { StepReview } from '../components/creation/steps/StepReview';
import { StepIndicator } from '~/shared/ui/StepIndicator';
import { WIZARD_STEPS, WIZARD_STEP_NAMES } from '../components/creation/steps';
import type { ImageryStepState } from '../components/imagery/types';
import { Button } from '~/shared/ui/forms';
import { FadeIn } from '~/shared/ui/motion';
import { capitalizeFirst } from '~/shared/utils/utility';

const NO_USERS: ProjectUserOut[] = [];

export const CreateCampaignPage = () => {
  const navigate = useNavigate();
  const projectId = useProjectIdParam();
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const showLoadingOverlay = useLayoutStore((s) => s.showLoadingOverlay);
  const hideLoadingOverlay = useLayoutStore((s) => s.hideLoadingOverlay);

  const [step, setStep] = useState(1);
  const [showValidation, setShowValidation] = useState(false);
  const queryClient = useQueryClient();

  const path = { project_id: projectId };
  const { data: project, isPending: loadingProject } = useQuery({
    ...getProjectOptions({ path }),
    meta: { errorMessage: 'Failed to load project' },
  });
  const { data: projectUsersData } = useQuery({
    ...getProjectUsersOptions({ path }),
    meta: { errorMessage: 'Failed to load project members' },
  });
  const projectUsers = projectUsersData?.users ?? NO_USERS;

  useEffect(() => {
    setBreadcrumbs([
      { label: 'Projects', path: projectsPath() },
      {
        label: project ? capitalizeFirst(project.name) : 'Project',
        path: projectPath(projectId),
      },
      { label: 'New Campaign' },
    ]);
  }, [project, projectId, setBreadcrumbs]);

  const [form, setForm] = useState<CampaignCreate>({
    name: '',
    project_id: projectId,
    settings: {
      labels: [],
      bbox_west: 33.9,
      bbox_south: -4.7,
      bbox_east: 41.9,
      bbox_north: 5.0,
    },
    imagery_editor_state: null,
    timeseries_configs: [],
    labelling_policy: DEFAULT_LABELLING_POLICY,
  });

  // Runs before the wizard is interactive (a skeleton covers the load), so
  // seeding the policy here can't overwrite anything the user picked.
  const projectIsPublic = project?.visibility === 'public';
  useEffect(() => {
    if (!projectIsPublic) return;
    setForm((current) => ({
      ...current,
      labelling_policy: withAnyoneSeeded(current.labelling_policy ?? DEFAULT_LABELLING_POLICY),
    }));
  }, [projectIsPublic]);

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

  const totalSteps = WIZARD_STEPS.length;

  const getStepContent = () => {
    const stepComponent = WIZARD_STEPS[step - 1]?.component;
    switch (stepComponent) {
      case 'StepCampaign':
        return <StepCampaign form={form} setForm={setForm} />;
      case 'StepSettings':
        return <StepSettings form={form} setForm={setForm} />;
      case 'StepImagery':
        return (
          <StepImagery
            projectId={projectId}
            form={form}
            setForm={setForm}
            imageryState={imageryState}
            setImageryState={setImageryState}
          />
        );
      case 'StepAddTimeseries':
        return <StepAddTimeseries form={form} setForm={setForm} />;
      case 'StepAccess':
        return (
          <StepAccess
            form={form}
            setForm={setForm}
            projectIsPublic={project?.visibility === 'public'}
            members={projectUsers}
          />
        );
      case 'StepReview':
        return <StepReview validation={validation} />;
      default:
        return null;
    }
  };

  const create = useMutation({
    ...createCampaignMutation(),
    meta: { errorMessage: 'Failed to create campaign' },
    onMutate: () => showLoadingOverlay('Creating campaign...'),
    onSettled: hideLoadingOverlay,
    onSuccess: (campaign) => {
      void queryClient.invalidateQueries({ queryKey: listProjectCampaignsQueryKey({ path }) });
      showAlert(
        campaign.registration_status === 'registering'
          ? 'Campaign created. Mosaic registration is running in the background...'
          : 'Campaign created successfully',
        campaign.registration_status === 'registering' ? 'info' : 'success'
      );
      navigate(campaignPath(campaign.project_id, campaign.id, 'annotate'));
    },
  });
  const isSubmitting = create.isPending;

  const handleSubmit = () => {
    if (isSubmitting) return;
    setShowValidation(true);
    if (!validation.isValid) return;
    create.mutate({ body: form });
  };

  // Only project admins may add campaigns to a project.
  if (!loadingProject && !project?.is_admin) {
    return <Navigate to={projectPath(projectId)} replace />;
  }

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">New campaign</h1>
          </div>
        </header>

        <div className="mb-6">
          <StepIndicator steps={WIZARD_STEP_NAMES} step={step} onStepClick={setStep} />
        </div>

        {loadingProject ? (
          <SkeletonForm sections={3} />
        ) : (
          <>
            <div className="surface">
              <div className="p-6">{getStepContent()}</div>
            </div>

            <div className="flex items-center justify-between mt-6 pb-8">
              <Button
                variant="secondary"
                disabled={isSubmitting}
                onClick={
                  step === 1 ? () => navigate(projectPath(projectId)) : () => setStep(step - 1)
                }
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
          </>
        )}
      </FadeIn>
    </div>
  );
};
