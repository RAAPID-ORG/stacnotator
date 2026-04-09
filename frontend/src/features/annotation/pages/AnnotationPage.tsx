import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useAnnotationStore } from '../stores/annotation.store';
import { useMapStore } from '../stores/map.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { useAnnotationKeyboard } from '../hooks/useAnnotationKeyboard';
import { useOpenModeKeyboard } from '../hooks/useOpenModeKeyboard';
import { AnnotationToolbar } from '../components/AnnotationToolbar';
import { Canvas } from '../components/Canvas';
import { GuidedTour } from '../components/GuidedTour';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { capitalizeFirst } from '~/shared/utils/utility';

export const AnnotationPage = () => {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Store subscriptions
  const campaign = useCampaignStore((s) => s.campaign);
  const isLoadingCampaign = useCampaignStore((s) => s.isLoadingCampaign);
  const loadCampaign = useCampaignStore((s) => s.loadCampaign);
  const visibleTasks = useTaskStore((s) => s.visibleTasks);

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

  // Early returns

  if (isRegistering && !hasBeenReady) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <svg
            className="animate-spin h-8 w-8 text-blue-500 mx-auto"
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
          <p className="text-lg font-semibold text-neutral-800">Campaign setup in progress</p>
          <p className="text-sm text-neutral-500 max-w-md">
            {campaign?.registration_status === 'registering' &&
              'Tile imagery is being registered from the STAC catalog. '}
            {campaign?.embedding_status === 'registering' &&
              'Satellite embeddings are being computed. '}
            This may take a few minutes. You&apos;ll be able to start annotating once setup
            completes.
          </p>
          <button
            onClick={() => navigate(`/campaigns/${campaignId}/settings`)}
            className="mt-2 px-4 py-2 text-sm font-medium text-brand-700 bg-brand-50 border border-brand-300 rounded-lg hover:bg-brand-100 transition-colors"
            type="button"
          >
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  if (!showContent) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading annotator..." />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-brand-800 mb-2">Campaign not found</p>
          <p className="text-neutral-600">The requested campaign could not be loaded.</p>
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
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">No Tasks Available</h3>
            <p className="text-neutral-600 mb-1">
              You've completed all assigned annotation tasks for this campaign! <br />
              Change your filter settings to see more tasks that were not assigned to you.
            </p>
          </div>
        </div>
      )}
      <GuidedTour isOpen={showGuidedTour} onClose={() => setShowGuidedTour(false)} />
    </div>
  );
};
