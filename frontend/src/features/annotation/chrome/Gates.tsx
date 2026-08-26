import type { CampaignOutFull } from '~/api/client';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';

const shell = 'flex flex-1 items-center justify-center px-6';
const heading = 'text-base font-semibold text-neutral-900';
const body = 'text-sm leading-relaxed text-neutral-500';

const button =
  'rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700';
const secondaryButton =
  'rounded border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50';

export function LoadingGate({ text = 'Loading annotator...' }: { text?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center" data-testid="loading-gate">
      <LoadingSpinner size="lg" text={text} />
    </div>
  );
}

export function NotFoundGate() {
  return (
    <div className={shell} data-testid="not-found-gate">
      <div className="text-center">
        <h2 className={`${heading} mb-1`}>Campaign not found</h2>
        <p className={body}>The requested campaign could not be loaded.</p>
      </div>
    </div>
  );
}

export interface RegisteringGateProps {
  campaign: CampaignOutFull | null;
  isCampaignAdmin: boolean;
  onBypass: () => void;
  onNavigateSettings?: () => void;
}

/** Imagery/embeddings still being ingested. Admins may enter anyway to author
 *  the campaign's views and layout - edit mode renders no window maps, so the
 *  missing tiles are harmless. */
export function RegisteringGate({
  campaign,
  isCampaignAdmin,
  onBypass,
  onNavigateSettings,
}: RegisteringGateProps) {
  return (
    <div className={shell} data-testid="registering-gate">
      <div className="max-w-md space-y-4 text-center">
        <LoadingSpinner size="lg" />
        <h2 className={heading}>Campaign setup in progress</h2>
        <p className={body}>
          {campaign?.registration_status === 'registering' &&
            'Mosaic imagery is being prepared from the STAC catalog. This can take several minutes. '}
          {campaign?.embedding_status === 'registering' &&
            'Satellite embeddings are being computed. '}
          This page checks progress automatically and will open the workspace as soon as setup
          completes.
        </p>
        <div className="flex items-center justify-center gap-2">
          {onNavigateSettings && (
            <button type="button" className={button} onClick={onNavigateSettings}>
              Go to settings
            </button>
          )}
          {isCampaignAdmin && (
            <button type="button" className={secondaryButton} onClick={onBypass}>
              Set up layout anyway
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export interface NoViewsGateProps {
  campaign: CampaignOutFull;
  isCampaignAdmin: boolean;
  onCreateFirstView: () => void;
  onNavigateSettings?: () => void;
}

/** A campaign without views has no annotation layout yet - annotators wait,
 *  admins author the first view right here in edit mode. */
export function NoViewsGate({
  campaign,
  isCampaignAdmin,
  onCreateFirstView,
  onNavigateSettings,
}: NoViewsGateProps) {
  const hasSources = campaign.imagery_sources.length > 0;

  return (
    <div className={shell} data-testid="no-views-gate">
      <div className="max-w-md space-y-4 text-center">
        {isCampaignAdmin ? (
          <>
            <h2 className={heading}>Set up the workspace</h2>
            <p className={body}>
              {hasSources
                ? 'One-time setup: nobody can start annotating until this campaign has a workspace layout. Create the first view - it starts with all imagery sources - then arrange the panels and save. What you save becomes the starting layout for every member of this campaign, and anyone can rearrange their own copy afterwards.'
                : 'This campaign has no imagery sources yet. Add sources in the campaign settings, then come back to set up the workspace.'}
            </p>
            {hasSources ? (
              <button
                type="button"
                className={button}
                onClick={onCreateFirstView}
                data-testid="create-first-view"
              >
                Create first view
              </button>
            ) : (
              onNavigateSettings && (
                <button type="button" className={button} onClick={onNavigateSettings}>
                  Go to settings
                </button>
              )
            )}
          </>
        ) : (
          <>
            <h2 className={heading}>Workspace not set up yet</h2>
            <p className={body}>
              A campaign admin still needs to lay out the workspace for this campaign. Please check
              back later.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export interface NoTasksGateProps {
  isCampaignAdmin: boolean;
  onNavigateTasks?: () => void;
  onSwitchToExplore: () => void;
}

export function NoTasksGate({
  isCampaignAdmin,
  onNavigateTasks,
  onSwitchToExplore,
}: NoTasksGateProps) {
  return (
    <div className={shell} data-testid="no-tasks-gate">
      <div className="max-w-md px-4 text-center">
        <h2 className={`${heading} mb-1.5`}>No annotation tasks yet</h2>
        <p className={`${body} mb-5`}>
          This campaign has no tasks set up. Tasks define the points or polygons that annotators
          will label.
        </p>
        <div className="flex items-center justify-center gap-2">
          {isCampaignAdmin && onNavigateTasks && (
            <button type="button" className={button} onClick={onNavigateTasks}>
              Set up tasks
            </button>
          )}
          <button type="button" className={secondaryButton} onClick={onSwitchToExplore}>
            Switch to Explore
          </button>
        </div>
        {!isCampaignAdmin && (
          <p className="mt-3 text-xs italic text-neutral-500">
            Ask a campaign admin to create tasks, or switch to Explore to start annotating now.
          </p>
        )}
      </div>
    </div>
  );
}

export interface AllTasksDoneGateProps {
  onShowAllTasks: () => void;
  onReview: () => void;
  /** The task set the filter is scoped to, when it is scoped to one. */
  scopeName?: string;
}

export function AllTasksDoneGate({ onShowAllTasks, onReview, scopeName }: AllTasksDoneGateProps) {
  return (
    <div className={shell} data-testid="all-tasks-done-gate">
      <div className="max-w-md px-4 text-center">
        <h2 className={`${heading} mb-1.5`}>All tasks completed</h2>
        <p className={`${body} mb-4`}>
          {scopeName
            ? `Every task in ${scopeName} has been answered - by you or by another annotator.`
            : "You've completed all pending tasks matching your current filter."}
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            className={button}
            onClick={onReview}
            data-testid="review-done-tasks"
          >
            Review them now
          </button>
          <button
            type="button"
            className={secondaryButton}
            onClick={onShowAllTasks}
            data-testid="show-all-tasks"
          >
            View all tasks
          </button>
        </div>
      </div>
    </div>
  );
}
