import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CampaignOutFull, ImageryViewOut, TaskOut, TaskSetOut } from '~/api/client';
import { useDismissOnOutside } from '~/shared/hooks/useDismissOnOutside';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Dropdown } from '~/shared/ui/motion';
import { BarButton } from '~/shared/ui/BarButton';
import {
  IconChevronLeft,
  IconDocument,
  IconFilter,
  IconFullscreen,
  IconFullscreenExit,
  IconGear,
  IconImage,
  IconQuestion,
} from '~/shared/ui/Icons';
import type { PolicyContext } from '~/features/campaigns/utils/labellingPolicy';
import { useCampaignStore } from '../../stores/campaign';
import { useLayoutStore as useAnnotationLayoutStore } from '../../stores/layout';
import type { TaskFilter } from '../../campaign/tasks';
import { ExportMenu } from '~/features/campaigns/components/review/ExportMenu';
import { GuidePanel } from './GuidePanel';
import { HelpMenu } from './HelpMenu';
import { ModeSwitch, OriginTaskChip, ReviewToggle } from './ModeSwitch';
import { TaskFilterPanel } from './TaskFilterPanel';

export interface ToolbarProps {
  campaign: CampaignOutFull;
  tasks: TaskOut[];
  taskSets: TaskSetOut[];
  taskFilter: TaskFilter;
  onTaskFilterChange: (patch: Partial<TaskFilter>) => void;
  policy: PolicyContext;
  /** Edit-layout controls (features/layout-edit's `EditControls`) - see the
   *  module doc for why this is a slot, not an import. */
  layoutControls?: ReactNode;
  onNavigateCampaign?: () => void;
  onNavigateWorkPage?: () => void;
  onNavigateSettings?: () => void;
  onOpenTour?: () => void;
}

function ViewPicker({ campaign }: { campaign: CampaignOutFull }) {
  const { t } = useTranslation('annotation');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedViewId = useCampaignStore((s) => s.view?.id ?? null);
  const selectView = useCampaignStore((s) => s.selectView);
  const views = campaign.imagery_views;
  const selected = views.find((v: ImageryViewOut) => v.id === selectedViewId);

  useDismissOnOutside(containerRef, () => setOpen(false), open);

  if (views.length === 0) return null;

  return (
    <div ref={containerRef} className="relative" data-tour="imagery-selector">
      <BarButton
        icon={IconImage}
        label={selected ? selected.name : t('toolbar.selectView')}
        menu
        collapse
        active={open}
        onClick={() => setOpen((o) => !o)}
        title={selected ? t('toolbar.viewTip', { name: selected.name }) : t('toolbar.switchView')}
        data-testid="view-picker-trigger"
      />
      <Dropdown
        open={open}
        className="absolute top-full left-0 mt-0.5 bg-white border border-neutral-200 rounded-lg shadow-lg z-20 min-w-[200px] max-h-[400px] overflow-y-auto origin-top-left"
      >
        {views.map((view: ImageryViewOut) => (
          <button
            key={view.id}
            type="button"
            onClick={() => {
              setOpen(false);
              selectView(view);
            }}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 transition-colors ${
              selectedViewId === view.id
                ? 'bg-neutral-100 text-brand-700 font-medium'
                : 'text-neutral-900'
            }`}
          >
            <div className="font-medium">{view.name}</div>
          </button>
        ))}
      </Dropdown>
    </div>
  );
}

export function Toolbar({
  campaign,
  tasks,
  taskSets,
  taskFilter,
  onTaskFilterChange,
  policy,
  layoutControls,
  onNavigateCampaign,
  onNavigateWorkPage,
  onNavigateSettings,
  onOpenTour,
}: ToolbarProps) {
  const { t } = useTranslation(['annotation', 'common']);
  const workMode = useCampaignStore((s) => s.workMode);
  const isReviewMode = useCampaignStore((s) => s.isReviewMode);
  const [taskFilterOpen, setTaskFilterOpen] = useState(false);
  // The tour holds this open while it explains what is inside it.
  const forcedOpen = useAnnotationLayoutStore((s) => s.forcedOpenControl) === 'task-filter';
  const taskFilterRef = useRef<HTMLDivElement>(null);
  const isFullscreen = useLayoutStore((s) => s.isFullscreen);
  const toggleFullscreen = useLayoutStore((s) => s.toggleFullscreen);

  useDismissOnOutside(taskFilterRef, () => setTaskFilterOpen(false), taskFilterOpen);

  const hasConflicts = tasks.some((task) => task.task_status === 'conflicting');

  return (
    <header
      data-tour="toolbar"
      className="flex items-center justify-between px-2 desktop:px-4 py-1 bg-white border-b border-neutral-200 flex-shrink-0 gap-1"
    >
      <div className="flex min-w-0 items-center gap-1">
        {onNavigateCampaign && (
          <BarButton
            icon={IconChevronLeft}
            onClick={onNavigateCampaign}
            title={t('toolbar.backTo', { name: campaign.name })}
            aria-label={t('toolbar.backTo', { name: campaign.name })}
            data-testid="back-to-campaign"
          />
        )}

        <div className="mx-1 h-5 w-px bg-neutral-200" />

        <ModeSwitch campaign={campaign} hasTasks={tasks.length > 0} policy={policy} />
        <OriginTaskChip />

        <ViewPicker campaign={campaign} />

        {workMode === 'tasks' && (
          <div ref={taskFilterRef} className="relative" data-tour="task-filter">
            <BarButton
              icon={IconFilter}
              label={t('toolbar.filter')}
              menu
              collapse
              active={taskFilterOpen}
              onClick={() => setTaskFilterOpen((o) => !o)}
              title={t('toolbar.filterTip')}
              data-testid="task-filter-trigger"
            />
            <Dropdown
              open={taskFilterOpen || forcedOpen}
              className="absolute top-full left-0 mt-1 origin-top-left z-20"
            >
              <div data-tour="task-filter-menu">
                <TaskFilterPanel
                  tasks={tasks}
                  taskSets={taskSets}
                  taskFilter={taskFilter}
                  onTaskFilterChange={onTaskFilterChange}
                  currentUserId={policy.userId}
                  isReviewMode={isReviewMode}
                />
              </div>
            </Dropdown>
          </div>
        )}

        <div className="flex items-center" data-tour="review-toggle">
          {workMode === 'tasks' && <ReviewToggle onTaskFilterChange={onTaskFilterChange} />}
        </div>

        {policy.isAdmin && onNavigateSettings && (
          <BarButton
            icon={IconGear}
            label={t('toolbar.settings')}
            collapse
            onClick={onNavigateSettings}
            title={t('toolbar.settingsTip')}
          />
        )}

        {onNavigateWorkPage && (
          <BarButton
            icon={IconDocument}
            label={workMode === 'tasks' ? t('toolbar.allTasks') : t('toolbar.allAnnotations')}
            collapse
            onClick={onNavigateWorkPage}
            title={workMode === 'tasks' ? t('toolbar.allTasksTip') : t('toolbar.allAnnotationsTip')}
            data-testid="open-work-list"
          />
        )}

        <ExportMenu
          campaignId={campaign.id}
          campaignName={campaign.name}
          showMergeToggle={workMode === 'tasks'}
          hasConflicts={hasConflicts}
          compact
        />
      </div>

      <div className="flex items-center gap-1">
        {layoutControls}

        <BarButton
          icon={isFullscreen ? IconFullscreenExit : IconFullscreen}
          onClick={toggleFullscreen}
          title={isFullscreen ? t('toolbar.exitFullscreen') : t('toolbar.enterFullscreen')}
          aria-label={isFullscreen ? t('toolbar.exitFullscreen') : t('toolbar.enterFullscreen')}
        />

        {onOpenTour && (
          <BarButton
            icon={IconQuestion}
            onClick={onOpenTour}
            title={t('toolbar.tour')}
            aria-label={t('toolbar.tour')}
          />
        )}

        <GuidePanel campaign={campaign} />
        <HelpMenu />
      </div>
    </header>
  );
}
