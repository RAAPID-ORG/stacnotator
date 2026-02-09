import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import useAnnotationStore from '../annotation.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { useAnnotationKeyboard } from '../hooks/useAnnotationKeyboard';
import { useOpenModeKeyboard } from '../hooks/useOpenModeKeyboard';
import { AnnotationToolbar } from '../components/AnnotationToolbar';
import { Canvas } from '../components/Canvas';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { capitalizeFirst } from '~/shared/utils/utility';

/**
 * Main annotation page for labeling campaign tasks
 * State managed through Zustand stores
 */
export const AnnotationPage = () => {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Annotation state
  const campaign = useAnnotationStore((state) => state.campaign);
  const isLoadingCampaign = useAnnotationStore((state) => state.isLoadingCampaign);
  const loadCampaign = useAnnotationStore((state) => state.loadCampaign);
  const reset = useAnnotationStore((state) => state.reset);
  const visibleTasks = useAnnotationStore((state) => state.visibleTasks);

  // UI state
  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const showAlert = useLayoutStore((state) => state.showAlert);

  const campaignIdNumber = Number(campaignId);

  // Enable keyboard shortcuts for task mode
  useAnnotationKeyboard({ commentInputRef });

  // Enable keyboard shortcuts for open mode
  useOpenModeKeyboard();

  // Load campaign data on mount (or when campaignId changes)
  useEffect(() => {
    if (!campaignId || Number.isNaN(campaignIdNumber)) {
      showAlert('Invalid campaign ID', 'error');
      return;
    }

    // Read task query param before starting — pass it into loadCampaign so
    // the filter + task index are set atomically in a single store update.
    const taskIdParam = searchParams.get('task');
    const reviewParam = searchParams.get('review');
    const initialTaskId = taskIdParam ? Number(taskIdParam) : undefined;
    const isReviewMode = reviewParam === 'true';
    if (taskIdParam || reviewParam) {
      // Clear the query params immediately so they don't persist on reload / StrictMode re-run
      setSearchParams({}, { replace: true });
    }

    let cancelled = false;

    const loadData = async () => {
      try {
        await loadCampaign(
          campaignIdNumber,
          initialTaskId && !Number.isNaN(initialTaskId) ? initialTaskId : undefined,
          isReviewMode,
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
  }, [campaignIdNumber]); // store actions are stable singletons

  // Update breadcrumbs when campaign loads
  useEffect(() => {
    if (campaign) {
      setBreadcrumbs([
        { label: 'Campaigns', path: '/campaigns' },
        { label: capitalizeFirst(campaign.name) },
      ]);
    }
  }, [campaign, setBreadcrumbs]);

  if (isLoadingCampaign) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading annotator..." />
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

  return (
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
              You've completed all assigned annotation tasks for this campaign! <br/>
              Change your filter settings to see more tasks that were not assigned to you.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
