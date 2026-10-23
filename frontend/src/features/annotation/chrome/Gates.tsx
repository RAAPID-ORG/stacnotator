import { useTranslation } from 'react-i18next';
import type { CampaignOutFull } from '~/api/client';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';

const shell = 'flex flex-1 items-center justify-center px-6';
const heading = 'text-base font-semibold text-neutral-900';
const body = 'text-sm leading-relaxed text-neutral-500';

const button =
  'rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700';
const secondaryButton =
  'rounded border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50';

export function LoadingGate({ text }: { text?: string }) {
  const { t } = useTranslation('annotation');
  return (
    <div className="flex flex-1 items-center justify-center" data-testid="loading-gate">
      <LoadingSpinner size="lg" text={text ?? t('gates.loading')} />
    </div>
  );
}

export function NotFoundGate() {
  const { t } = useTranslation('annotation');
  return (
    <div className={shell} data-testid="not-found-gate">
      <div className="text-center">
        <h2 className={`${heading} mb-1`}>{t('gates.notFound.title')}</h2>
        <p className={body}>{t('gates.notFound.body')}</p>
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
  const { t } = useTranslation('annotation');
  return (
    <div className={shell} data-testid="registering-gate">
      <div className="max-w-md space-y-4 text-center">
        <LoadingSpinner size="lg" />
        <h2 className={heading}>{t('gates.registering.title')}</h2>
        <p className={body}>
          {campaign?.registration_status === 'registering' && t('gates.registering.mosaics')}
          {campaign?.embedding_status === 'registering' && t('gates.registering.embeddings')}
          {t('gates.registering.autoOpen')}
        </p>
        <div className="flex items-center justify-center gap-2">
          {onNavigateSettings && (
            <button type="button" className={button} onClick={onNavigateSettings}>
              {t('gates.goToSettings')}
            </button>
          )}
          {isCampaignAdmin && (
            <button type="button" className={secondaryButton} onClick={onBypass}>
              {t('gates.registering.bypass')}
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
  const { t } = useTranslation('annotation');
  const hasSources = campaign.imagery_sources.length > 0;

  return (
    <div className={shell} data-testid="no-views-gate">
      <div className="max-w-md space-y-4 text-center">
        {isCampaignAdmin ? (
          <>
            <h2 className={heading}>{t('gates.noViews.title')}</h2>
            <p className={body}>
              {hasSources ? t('gates.noViews.body') : t('gates.noViews.noSources')}
            </p>
            {hasSources ? (
              <button
                type="button"
                className={button}
                onClick={onCreateFirstView}
                data-testid="create-first-view"
              >
                {t('gates.noViews.create')}
              </button>
            ) : (
              onNavigateSettings && (
                <button type="button" className={button} onClick={onNavigateSettings}>
                  {t('gates.goToSettings')}
                </button>
              )
            )}
          </>
        ) : (
          <>
            <h2 className={heading}>{t('gates.noViews.waitTitle')}</h2>
            <p className={body}>{t('gates.noViews.waitBody')}</p>
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
  const { t } = useTranslation('annotation');
  return (
    <div className={shell} data-testid="no-tasks-gate">
      <div className="max-w-md px-4 text-center">
        <h2 className={`${heading} mb-1.5`}>{t('gates.noTasks.title')}</h2>
        <p className={`${body} mb-5`}>{t('gates.noTasks.body')}</p>
        <div className="flex items-center justify-center gap-2">
          {isCampaignAdmin && onNavigateTasks && (
            <button type="button" className={button} onClick={onNavigateTasks}>
              {t('gates.noTasks.setUp')}
            </button>
          )}
          <button type="button" className={secondaryButton} onClick={onSwitchToExplore}>
            {t('gates.noTasks.switchToExplore')}
          </button>
        </div>
        {!isCampaignAdmin && (
          <p className="mt-3 text-xs italic text-neutral-500">{t('gates.noTasks.askAdmin')}</p>
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
  const { t } = useTranslation('annotation');
  return (
    <div className={shell} data-testid="all-tasks-done-gate">
      <div className="max-w-md px-4 text-center">
        <h2 className={`${heading} mb-1.5`}>{t('gates.allDone.title')}</h2>
        <p className={`${body} mb-4`}>
          {scopeName ? t('gates.allDone.scoped', { name: scopeName }) : t('gates.allDone.body')}
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            className={button}
            onClick={onReview}
            data-testid="review-done-tasks"
          >
            {t('gates.allDone.review')}
          </button>
          <button
            type="button"
            className={secondaryButton}
            onClick={onShowAllTasks}
            data-testid="show-all-tasks"
          >
            {t('gates.allDone.viewAll')}
          </button>
        </div>
      </div>
    </div>
  );
}
