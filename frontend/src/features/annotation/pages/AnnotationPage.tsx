import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useAnnotationStore } from '../stores/annotation.store';
import { useMapStore } from '../stores/map.store';
import { useAccountStore } from '~/features/account/account.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { useAnnotationKeyboard } from '../hooks/useAnnotationKeyboard';
import { useOpenModeKeyboard } from '../hooks/useOpenModeKeyboard';
import { AnnotationToolbar } from '../components/AnnotationToolbar';
import { Canvas } from '../components/Canvas';
import { GuidedTour } from '../components/GuidedTour';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { capitalizeFirst } from '~/shared/utils/utility';
import { Button } from '~/shared/ui/forms';

/**
 * Key used to mark that a given (user, campaign) pair has already seen the
 * guided tour. localStorage-scoped: resets on new devices/browsers, which is
 * acceptable for an onboarding nudge.
 */
const tourSeenKey = (userId: string, campaignId: number) =>
  `stacnotator:tour-seen:${userId}:${campaignId}`;

const hasSeenTour = (userId: string | undefined, campaignId: number): boolean => {
  if (!userId) return true; // fail-safe: don't auto-open if we can't identify user
  try {
    return localStorage.getItem(tourSeenKey(userId, campaignId)) === '1';
  } catch {
    return true;
  }
};

const markTourSeen = (userId: string | undefined, campaignId: number) => {
  if (!userId) return;
  try {
    localStorage.setItem(tourSeenKey(userId, campaignId), '1');
  } catch {
    // localStorage unavailable (private browsing etc.) - ignore
  }
};

export const AnnotationPage = () => {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Store subscriptions
  const campaign = useCampaignStore((s) => s.campaign);
  const isCampaignAdmin = useCampaignStore((s) => s.isCampaignAdmin);
  const isLoadingCampaign = useCampaignStore((s) => s.isLoadingCampaign);
  const loadCampaign = useCampaignStore((s) => s.loadCampaign);
  const visibleTasks = useTaskStore((s) => s.visibleTasks);
  const allTasks = useTaskStore((s) => s.allTasks);
  const accountId = useAccountStore((s) => s.account?.id);

  // UI store
  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const showAlert = useLayoutStore((state) => state.showAlert);
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

  const campaignIdNumber = Number(campaignId);

  // Keyboard shortcuts
  useAnnotationKeyboard({ commentInputRef });
  useOpenModeKeyboard();

  // Load campaign
  useEffect(() => {
    if (!campaignId || Number.isNaN(campaignIdNumber)) {
      showAlert('Invalid campaign ID', 'error');
      return;
    }

    const taskIdParam = searchParams.get('task');
    const reviewParam = searchParams.get('review');
    const initialTaskId = taskIdParam ? Number(taskIdParam) : undefined;
    const isReviewMode = reviewParam === 'true';

    if (taskIdParam || reviewParam) {
      setSearchParams({}, { replace: true });
    }

    let cancelled = false;

    const loadData = async () => {
      try {
        await loadCampaign(
          campaignIdNumber,
          initialTaskId && !Number.isNaN(initialTaskId) ? initialTaskId : undefined,
          isReviewMode
        );
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load campaign:', error);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignIdNumber]);

  // Breadcrumbs
  useEffect(() => {
    if (campaign) {
      setBreadcrumbs([
        { label: 'Campaigns', path: '/campaigns' },
        { label: capitalizeFirst(campaign.name) },
      ]);
    }
  }, [campaign, setBreadcrumbs]);

  // Auto-show the guided tour the first time this user opens this campaign.
  // For task-mode we wait until visibleTasks > 0 so the tour can actually
  // walk through the task UI. Fires at most once per (user, campaign) pair,
  // tracked in localStorage.
  const [autoTourChecked, setAutoTourChecked] = useState(false);
  useEffect(() => {
    if (!showContent || !campaign || autoTourChecked || !accountId) return;
    const canTour = campaign.mode === 'open' || visibleTasks.length > 0;
    if (!canTour) return; // wait for tasks (task mode with empty visibleTasks)
    setAutoTourChecked(true);
    if (!hasSeenTour(accountId, campaign.id)) {
      setShowGuidedTour(true);
    }
  }, [showContent, campaign, visibleTasks.length, accountId, autoTourChecked, setShowGuidedTour]);

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
      {campaign &&
      ((campaign.mode == 'tasks' && visibleTasks.length > 0) || campaign.mode == 'open') ? (
        <Canvas commentInputRef={commentInputRef} />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-4">
            <div className="mb-4">
              <svg
                className="mx-auto h-16 w-16 text-neutral-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            {/* Distinguish "no tasks set up on the campaign at all" (admin action
                needed) from "user filtered them all out / completed them" */}
            {campaign.mode === 'tasks' && allTasks.length === 0 ? (
              <>
                <h2 className="text-base font-semibold text-neutral-900 mb-1.5">
                  No annotation tasks yet
                </h2>
                <p className="text-sm text-neutral-500 mb-5 leading-relaxed">
                  This campaign has no tasks set up. Tasks define the points or polygons that
                  annotators will label.
                </p>
                {isCampaignAdmin ? (
                  <Button onClick={() => navigate(`/campaigns/${campaignId}/settings?tab=tasks`)}>
                    Set up tasks in settings
                  </Button>
                ) : (
                  <p className="text-xs text-neutral-500 italic">
                    Ask a campaign admin to create tasks before you can start annotating.
                  </p>
                )}
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-neutral-900 mb-1.5">
                  No tasks available
                </h2>
                <p className="text-sm text-neutral-500 leading-relaxed">
                  You&apos;ve completed all assigned annotation tasks for this campaign.
                  <br />
                  Change your filter settings to see more tasks that were not assigned to you.
                </p>
              </>
            )}
          </div>
        </div>
      )}
      <GuidedTour isOpen={showGuidedTour} onClose={handleTourClose} />
    </div>
  );
};
