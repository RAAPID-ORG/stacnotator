import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useCampaignStore, type WorkMode } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useAnnotationStore } from '../stores/annotation.store';
import { useMapStore } from '../stores/map.store';
import { usePopoutStore } from '../stores/popout.store';
import { useAccountStore } from '~/features/account/account.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { hasSeenTour, usePreferencesStore } from '../stores/preferences.store';
import { useAnnotationKeyboard } from '../hooks/useAnnotationKeyboard';
import { useOpenModeKeyboard } from '../hooks/useOpenModeKeyboard';
import { useCampaignIdParam } from '~/features/campaigns/hooks/useCampaignIdParam';
import { AnnotationToolbar } from '../components/AnnotationToolbar';
import { Canvas } from '../components/Canvas';
import { GuidedTour } from '../components/GuidedTour';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { capitalizeFirst } from '~/shared/utils/utility';
import { handleError } from '~/shared/utils/errorHandler';
import { Button } from '~/shared/ui/forms';
import { isAudienceMember } from '../utils/labellingPolicy';

const WORK_MODES = ['tasks', 'explore'] as const;
const isWorkMode = (value: string): value is WorkMode =>
  (WORK_MODES as readonly string[]).includes(value);

export const AnnotationPage = () => {
  const campaignId = useCampaignIdParam();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Store subscriptions
  const campaign = useCampaignStore((s) => s.campaign);
  const isCampaignAdmin = useCampaignStore((s) => s.isCampaignAdmin);
  const isAuthoritativeReviewer = useCampaignStore((s) => s.isAuthoritativeReviewer);
  const isCampaignMember = useCampaignStore((s) => s.isCampaignMember);
  const isLoadingCampaign = useCampaignStore((s) => s.isLoadingCampaign);
  const loadCampaign = useCampaignStore((s) => s.loadCampaign);
  const workMode = useCampaignStore((s) => s.workMode);
  const setWorkMode = useCampaignStore((s) => s.setWorkMode);
  const visibleTasks = useTaskStore((s) => s.visibleTasks);
  const allTasks = useTaskStore((s) => s.allTasks);
  const tasksLoaded = useTaskStore((s) => s.tasksLoaded);
  const accountId = useAccountStore((s) => s.account?.id);

  // UI store
  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const showGuidedTour = useLayoutStore((state) => state.showGuidedTour);
  const setShowGuidedTour = useLayoutStore((state) => state.setShowGuidedTour);

  const [hasBeenReady, setHasBeenReady] = useState(false);
  const isRegistering =
    campaign?.registration_status === 'registering' || campaign?.embedding_status === 'registering';
  const isReady = !isLoadingCampaign && !!campaign && !isRegistering;
  useEffect(() => {
    if (isReady && !hasBeenReady) setHasBeenReady(true);
  }, [isReady, hasBeenReady]);

  const showContent = hasBeenReady;

  // Keyboard shortcuts
  useAnnotationKeyboard({ commentInputRef });
  useOpenModeKeyboard();

  // Load campaign
  useEffect(() => {
    const taskIdParam = searchParams.get('task');
    const reviewParam = searchParams.get('review');
    const modeParam = searchParams.get('mode');
    const taskSetParam = searchParams.get('taskSet');
    const initialTaskId = taskIdParam ? Number(taskIdParam) : undefined;
    const isReviewMode = reviewParam === 'true';
    const initialWorkMode = modeParam && isWorkMode(modeParam) ? modeParam : undefined;
    const initialTaskSetId = taskSetParam ? Number(taskSetParam) : undefined;

    if (taskIdParam || reviewParam || modeParam || taskSetParam) {
      setSearchParams({}, { replace: true });
    }

    let cancelled = false;

    const loadData = async () => {
      try {
        await loadCampaign(
          campaignId,
          initialTaskId && !Number.isNaN(initialTaskId) ? initialTaskId : undefined,
          isReviewMode,
          initialWorkMode,
          initialTaskSetId && !Number.isNaN(initialTaskSetId) ? initialTaskSetId : undefined
        );
      } catch (error) {
        if (!cancelled) {
          handleError(error, 'Failed to load campaign', { showUser: false });
        }
      }
    };

    loadData();

    return () => {
      cancelled = true;
      useCampaignStore.getState().reset();
      useTaskStore.getState().reset();
      useAnnotationStore.getState().reset();
      useMapStore.getState().reset();
      usePopoutStore.getState().closeAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  // Breadcrumbs
  useEffect(() => {
    if (campaign) {
      setBreadcrumbs([
        { label: 'Campaigns', path: '/campaigns' },
        { label: capitalizeFirst(campaign.name), path: `/campaigns/${campaignId}` },
      ]);
    }
  }, [campaign, campaignId, setBreadcrumbs]);

  // A deep link (?mode=explore) can seed workMode='explore' even for a user
  // the campaign's labelling policy doesn't allow to explore. The toolbar
  // switch is disabled for them going forward, but that alone would leave
  // them stuck on a dead-end mode with no button to get out - so if there
  // are tasks to fall back to, bounce them to Tasks once tasks have loaded.
  useEffect(() => {
    if (!campaign || !tasksLoaded || workMode !== 'explore' || allTasks.length === 0) return;
    const exploreAllowed = isAudienceMember(campaign.settings.labelling_policy.explore, {
      userId: accountId ?? null,
      isAdmin: isCampaignAdmin,
      isAuthoritative: isAuthoritativeReviewer,
      isMember: isCampaignMember,
    });
    if (!exploreAllowed) setWorkMode('tasks');
  }, [
    campaign,
    tasksLoaded,
    workMode,
    allTasks.length,
    accountId,
    isCampaignAdmin,
    isAuthoritativeReviewer,
    isCampaignMember,
    setWorkMode,
  ]);

  // Auto-show the guided tour the first time this user opens this campaign.
  // For task-mode we wait until visibleTasks > 0 so the tour can actually
  // walk through the task UI. Fires at most once per (user, campaign) pair,
  // tracked in localStorage.
  const [autoTourChecked, setAutoTourChecked] = useState(false);
  useEffect(() => {
    if (!showContent || !campaign || autoTourChecked || !accountId) return;
    const canTour = workMode === 'explore' || visibleTasks.length > 0;
    if (!canTour) return; // wait for tasks (task mode with empty visibleTasks)
    setAutoTourChecked(true);
    if (!hasSeenTour(accountId, campaign.id)) {
      setShowGuidedTour(true);
    }
  }, [
    showContent,
    campaign,
    workMode,
    visibleTasks.length,
    accountId,
    autoTourChecked,
    setShowGuidedTour,
  ]);

  const markTourSeen = usePreferencesStore((s) => s.markTourSeen);
  const handleTourClose = () => {
    setShowGuidedTour(false);
    if (campaign && accountId) markTourSeen(accountId, campaign.id);
  };

  // Early returns

  if (isRegistering && !hasBeenReady) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-md space-y-4">
          <svg
            className="animate-spin h-7 w-7 text-brand-600 mx-auto"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <h2 className="text-base font-semibold text-neutral-900">Campaign setup in progress</h2>
          <p className="text-sm text-neutral-500 leading-relaxed">
            {campaign?.registration_status === 'registering' &&
              'Tile imagery is being registered from the STAC catalog. '}
            {campaign?.embedding_status === 'registering' &&
              'Satellite embeddings are being computed. '}
            This may take a few minutes. You&apos;ll be able to start annotating once setup
            completes.
          </p>
          <Button onClick={() => navigate(`/campaigns/${campaignId}/settings`)}>
            Go to settings
          </Button>
        </div>
      </div>
    );
  }

  if (!showContent) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading annotator…" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center">
          <h2 className="text-base font-semibold text-neutral-900 mb-1">Campaign not found</h2>
          <p className="text-sm text-neutral-500">The requested campaign could not be loaded.</p>
        </div>
      </div>
    );
  }

  // Render
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <AnnotationToolbar />
      {campaign && ((workMode === 'tasks' && visibleTasks.length > 0) || workMode === 'explore') ? (
        <Canvas commentInputRef={commentInputRef} />
      ) : workMode === 'tasks' && !tasksLoaded ? (
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-4">
            {workMode === 'tasks' && allTasks.length === 0 ? (
              <>
                <h2 className="text-base font-semibold text-neutral-900 mb-1.5">
                  No annotation tasks yet
                </h2>
                <p className="text-sm text-neutral-500 mb-5 leading-relaxed">
                  This campaign has no tasks set up. Tasks define the points or polygons that
                  annotators will label.
                </p>
                <div className="flex items-center justify-center gap-2">
                  {isCampaignAdmin && (
                    <Button onClick={() => navigate(`/campaigns/${campaignId}/tasks`)}>
                      Set up tasks
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => setWorkMode('explore')}>
                    Switch to Explore
                  </Button>
                </div>
                {!isCampaignAdmin && (
                  <p className="text-xs text-neutral-500 italic mt-3">
                    Ask a campaign admin to create tasks, or switch to Explore to start annotating
                    now.
                  </p>
                )}
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-neutral-900 mb-1.5">
                  All tasks completed
                </h2>
                <p className="text-sm text-neutral-500 mb-4 leading-relaxed">
                  You&apos;ve completed all pending tasks matching your current filter.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    useTaskStore.getState().setTaskFilter({
                      assignedTo: [],
                      statuses: ['pending', 'partial', 'done', 'skipped', 'conflicting'],
                    });
                  }}
                >
                  View all tasks
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      <GuidedTour isOpen={showGuidedTour} onClose={handleTourClose} />
    </div>
  );
};
