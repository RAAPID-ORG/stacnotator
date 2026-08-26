import { useRef, useState, type ReactNode } from 'react';
import type { CampaignOutFull, ImageryViewOut, AnnotationTaskOut, TaskSetOut } from '~/api/client';
import { useDismissOnOutside } from '~/shared/hooks/useDismissOnOutside';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Dropdown } from '~/shared/ui/motion';
import {
  IconChevronDownFilled,
  IconChevronLeft,
  IconFullscreenExitFilled,
  IconFullscreenFilled,
  IconGearFilled,
  IconImageFilled,
  IconMenuFilled,
  IconQuestion,
  IconTaskListFilled,
} from '~/shared/ui/Icons';
import type { PolicyContext } from '~/features/campaigns/utils/labellingPolicy';
import { useCampaignStore } from '../../stores/campaign';
import type { TaskFilter } from '../../campaign/tasks';
import { ExportMenu } from './ExportMenu';
import { GuidePanel } from './GuidePanel';
import { HelpMenu } from './HelpMenu';
import { ModeSwitch, ReviewToggle } from './ModeSwitch';
import { TaskFilterPanel } from './TaskFilterPanel';

export interface ToolbarProps {
  campaign: CampaignOutFull;
  tasks: AnnotationTaskOut[];
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
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 desktop:gap-2 px-2 desktop:px-3 py-1.5 text-sm text-neutral-900 hover:bg-neutral-100 rounded transition-colors ${open ? 'bg-neutral-100' : ''}`}
        title={selected ? `View: ${selected.name}` : 'Switch View (u)'}
        data-testid="view-picker-trigger"
      >
        <IconImageFilled className="w-5 h-5" />
        <span className="hidden desktop:inline">{selected ? selected.name : 'Select View'}</span>
        <IconChevronDownFilled className="hidden desktop:block w-4 h-4" />
      </button>
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
  const workMode = useCampaignStore((s) => s.workMode);
  const isReviewMode = useCampaignStore((s) => s.isReviewMode);
  const [taskFilterOpen, setTaskFilterOpen] = useState(false);
  const taskFilterRef = useRef<HTMLDivElement>(null);
  const isFullscreen = useLayoutStore((s) => s.isFullscreen);
  const toggleFullscreen = useLayoutStore((s) => s.toggleFullscreen);

  useDismissOnOutside(taskFilterRef, () => setTaskFilterOpen(false), taskFilterOpen);

  const hasConflicts = tasks.some((t) => t.task_status === 'conflicting');

  return (
    <header
      data-tour="toolbar"
      className="flex items-center justify-between px-2 desktop:px-4 py-1 bg-white border-b border-neutral-200 flex-shrink-0 gap-1"
    >
      <div className="flex items-center gap-0.5 desktop:gap-2">
        {onNavigateCampaign && (
          <button
            type="button"
            onClick={onNavigateCampaign}
            className="flex items-center rounded px-1.5 py-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
            title={`Back to ${campaign.name}`}
            aria-label={`Back to ${campaign.name}`}
            data-testid="back-to-campaign"
          >
            <IconChevronLeft className="h-4 w-4 shrink-0" />
          </button>
        )}

        <ModeSwitch campaign={campaign} hasTasks={tasks.length > 0} policy={policy} />

        <ViewPicker campaign={campaign} />

        {workMode === 'tasks' && (
          <div ref={taskFilterRef} className="relative" data-tour="task-filter">
            <button
              type="button"
              onClick={() => setTaskFilterOpen((o) => !o)}
              className={`flex items-center gap-1 desktop:gap-2 px-2 desktop:px-3 py-1.5 text-sm text-neutral-900 hover:bg-neutral-100 rounded transition-colors ${taskFilterOpen ? 'bg-neutral-100' : ''}`}
              title="Filter visible tasks"
              data-testid="task-filter-trigger"
            >
              <IconTaskListFilled className="w-5 h-5" />
              <span className="hidden desktop:inline">Filter Tasks</span>
              <IconChevronDownFilled className="hidden desktop:block w-4 h-4" />
            </button>
            <Dropdown
              open={taskFilterOpen}
              className="absolute top-full left-0 mt-1 origin-top-left z-20"
            >
              <TaskFilterPanel
                tasks={tasks}
                taskSets={taskSets}
                taskFilter={taskFilter}
                onTaskFilterChange={onTaskFilterChange}
                currentUserId={policy.userId}
                isReviewMode={isReviewMode}
              />
            </Dropdown>
          </div>
        )}

        <div className="flex items-center rounded overflow-hidden" data-tour="review-toggle">
          {workMode === 'tasks' && (
            <>
              <ReviewToggle onTaskFilterChange={onTaskFilterChange} />
              {onNavigateWorkPage && <div className="w-px h-5 bg-neutral-200" />}
            </>
          )}
          {onNavigateWorkPage && (
            <button
              type="button"
              onClick={onNavigateWorkPage}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
              title={workMode === 'tasks' ? 'Go to Tasks page' : 'Go to Annotations page'}
            >
              <IconMenuFilled className="w-4 h-4" />
              {workMode !== 'tasks' && <span>Annotations</span>}
            </button>
          )}
        </div>

        {policy.isAdmin && onNavigateSettings && (
          <button
            type="button"
            onClick={onNavigateSettings}
            className="flex items-center gap-1 desktop:gap-2 px-2 desktop:px-3 py-1.5 text-sm text-neutral-700 bg-white hover:bg-neutral-50 rounded transition-colors"
            title="Campaign Settings"
          >
            <IconGearFilled className="w-5 h-5" />
            <span className="hidden desktop:inline">Settings</span>
          </button>
        )}

        <ExportMenu
          campaignId={campaign.id}
          campaignName={campaign.name}
          isTaskMode={workMode === 'tasks'}
          hasConflicts={hasConflicts}
        />
      </div>

      <div className="flex items-center gap-0.5 desktop:gap-2" data-tour="layout-controls">
        {layoutControls}

        <button
          type="button"
          onClick={toggleFullscreen}
          className="flex items-center justify-center w-8 h-8 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
          title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? (
            <IconFullscreenExitFilled className="w-5 h-5" />
          ) : (
            <IconFullscreenFilled className="w-5 h-5" />
          )}
        </button>

        {onOpenTour && (
          <button
            type="button"
            onClick={onOpenTour}
            className="flex items-center justify-center w-8 h-8 text-neutral-500 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"
            title="Take guided tour"
          >
            <IconQuestion className="w-5 h-5" />
          </button>
        )}

        <GuidePanel campaign={campaign} />
        <HelpMenu />
      </div>
    </header>
  );
}
