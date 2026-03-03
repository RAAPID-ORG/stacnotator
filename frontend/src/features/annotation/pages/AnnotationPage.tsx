import { useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import useAnnotationStore from '../annotation.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { useAnnotationKeyboard } from '../hooks/useAnnotationKeyboard';
import { useOpenModeKeyboard } from '../hooks/useOpenModeKeyboard';
import { AnnotationToolbar } from '../components/AnnotationToolbar';
import { Canvas } from '../components/Canvas';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { capitalizeFirst } from '~/shared/utils/utility';
import { useStacAllSlices } from '../hooks/useStacAllSlices';
import { SliceLayerMapProvider } from '../context/SliceLayerMapContext';

/**
 * Main annotation page for labeling campaign tasks.
 * State managed through Zustand stores.
 *
 * STAC pre-registration strategy
 * ────────────────────────────────
 * While the campaign is loading (spinner phase) we fire useStacAllSlices which
 * registers mosaic search IDs for EVERY window × EVERY slice of the selected
 * imagery. Results are cached at module level so the maps never re-register.
 *
 * Priority order during registration:
 *   1. Slice-0 of every window  (ensures all windows open without a blank map)
 *   2. Remaining slices of the active window
 *   3. Remaining slices of all other windows
 *
 * The Canvas is only shown once all slice-0 registrations are complete so that
 * every window map has a valid tile URL from the very first render.
 *
 * The resolved SliceLayerMap is distributed to TaskModeMap and ImageryContainer
 * via SliceLayerMapContext - no prop-drilling through Canvas.
 */
export const AnnotationPage = () => {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Store subscriptions
  const campaign = useAnnotationStore((state) => state.campaign);
  const isLoadingCampaign = useAnnotationStore((state) => state.isLoadingCampaign);
  const loadCampaign = useAnnotationStore((state) => state.loadCampaign);
  const reset = useAnnotationStore((state) => state.reset);
  const visibleTasks = useAnnotationStore((state) => state.visibleTasks);
  const selectedImageryId = useAnnotationStore((state) => state.selectedImageryId);
  const activeWindowId = useAnnotationStore((state) => state.activeWindowId);

  // UI store
  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const showAlert = useLayoutStore((state) => state.showAlert);

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
      reset();
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

  // STAC pre-registration
  // Derive the selected imagery + campaign bbox once the campaign is loaded.
  const selectedImagery = useMemo(
    () => campaign?.imagery.find((img) => img.id === selectedImageryId) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaign, selectedImageryId]
  );

  const campaignBbox = useMemo(
    () =>
      campaign
        ? ([
            campaign.settings.bbox_west,
            campaign.settings.bbox_south,
            campaign.settings.bbox_east,
            campaign.settings.bbox_north,
          ] as [number, number, number, number])
        : ([0, 0, 0, 0] as [number, number, number, number]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      campaign?.settings.bbox_west,
      campaign?.settings.bbox_south,
      campaign?.settings.bbox_east,
      campaign?.settings.bbox_north,
    ]
  );

  const effectiveActiveWindowId =
    activeWindowId ?? selectedImagery?.default_main_window_id ?? null;

  // Register ALL windows × ALL slices eagerly. Priority:
  //   1. Slice-0 of every window (needed to show all windows immediately)
  //   2. Remaining slices of the active window
  //   3. Remaining slices of other windows
  const { sliceLayerMap, totalSlices, registeredSlices } = useStacAllSlices({
    imagery: selectedImagery,
    bbox: campaignBbox,
    activeWindowId: effectiveActiveWindowId,
    // Begin as soon as campaign meta is available (still on the spinner)
    enabled: !!selectedImagery && !isLoadingCampaign,
  });

  // Block Canvas until slice-0 of every window is ready - guarantees each
  // WindowMap has a valid tile URL on its very first render.
  const slice0Count = selectedImagery?.windows.length ?? 0;
  const allSlice0sReady = slice0Count === 0 || registeredSlices >= slice0Count;

  // Early returns

  if (isLoadingCampaign || (campaign && selectedImagery && !allSlice0sReady)) {
    const progressText =
      !isLoadingCampaign && totalSlices > 0
        ? `Preparing imagery… (${registeredSlices}/${totalSlices})`
        : 'Loading annotator...';
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" text={progressText} />
      </div>
    );
  }

  if (!campaign && !isLoadingCampaign) {
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
    <SliceLayerMapProvider value={{ sliceLayerMap, totalSlices, registeredSlices }}>
      <div className="flex flex-col h-full">
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
      </div>
    </SliceLayerMapProvider>
  );
};
