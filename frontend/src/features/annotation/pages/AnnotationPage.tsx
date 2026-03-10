import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
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
import { useStacRegistration } from '../hooks/useStacRegistration';

/**
 * Main annotation page for labeling campaign tasks.
 * State managed through Zustand stores.
 *
 * STAC registrations start here (page level) so the loading spinner
 * covers both campaign data fetching and STAC search-ID resolution.
 * The module-level cache in useStacRegistration ensures downstream
 * consumers (MainAnnotationContainer, ImageryContainer) share results
 * without duplicate requests.
 */
export const AnnotationPage = () => {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Store subscriptions
  const campaign = useCampaignStore((s) => s.campaign);
  const isLoadingCampaign = useCampaignStore((s) => s.isLoadingCampaign);
  const loadCampaign = useCampaignStore((s) => s.loadCampaign);
  const selectedImageryId = useCampaignStore((s) => s.selectedImageryId);
  const visibleTasks = useTaskStore((s) => s.visibleTasks);

  // UI store
  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const showAlert = useLayoutStore((state) => state.showAlert);
  const showGuidedTour = useLayoutStore((state) => state.showGuidedTour);
  const setShowGuidedTour = useLayoutStore((state) => state.setShowGuidedTour);

  // Start STAC registrations as soon as campaign data is available
  const selectedImagery = campaign?.imagery.find((img) => img.id === selectedImageryId) ?? null;
  const campaignBbox = useMemo(
    () => campaign
      ? ([
          campaign.settings.bbox_west,
          campaign.settings.bbox_south,
          campaign.settings.bbox_east,
          campaign.settings.bbox_north,
        ] as [number, number, number, number])
      : ([0, 0, 0, 0] as [number, number, number, number]),
    [campaign?.settings.bbox_west, campaign?.settings.bbox_south, campaign?.settings.bbox_east, campaign?.settings.bbox_north]
  );
  const { allRegistered } = useStacRegistration({
    imagery: selectedImagery,
    bbox: campaignBbox,
    enabled: !!selectedImagery,
  });

  // Gate only on the INITIAL load. Once the annotator has been shown,
  // keep it mounted so the OL map survives imagery switches. The
  // MainAnnotationContainer shows its own in-map spinner while STAC
  // registrations are in progress for a newly selected imagery.
  const [hasBeenReady, setHasBeenReady] = useState(false);
  const isReady = !isLoadingCampaign && allRegistered;
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
          <p className="text-gray-600">The requested campaign could not be loaded.</p>
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
                className="mx-auto h-16 w-16 text-gray-400"
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
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Tasks Available</h3>
            <p className="text-gray-600 mb-1">
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
