import { useState, type ReactNode } from 'react';
import type { CampaignOutFull, ImageryViewOut, AnnotationTaskOut, TaskSetOut } from '~/api/client';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Dropdown } from '~/shared/ui/motion';
import {
  IconChevronDown,
  IconFullscreen,
  IconFullscreenExit,
  IconGear,
  IconImage,
  IconList,
  IconQuestion,
  IconTaskList,
} from '~/shared/ui/Icons';
import type { PolicyContext } from '~/features/annotation/core/annotation';
import type { Catalog } from '~/features/annotation/core/catalog';
import { useSessionStore } from '~/features/annotation/stores';
import type { TaskFilter } from '~/features/annotation/core/tasks';
import { fallbackCollectionFor } from '../../shared/viewSelection';
import { ExportMenu } from './ExportMenu';
import { GuidePanel } from './GuidePanel';
import { HelpMenu } from './HelpMenu';
import { ModeSwitch, ReviewToggle } from './ModeSwitch';
import { TaskFilterPanel } from './TaskFilterPanel';

export interface ToolbarProps {
  campaign: CampaignOutFull;
  catalog: Catalog;
  tasks: AnnotationTaskOut[];
  taskSets: TaskSetOut[];
  taskFilter: TaskFilter;
  onTaskFilterChange: (patch: Partial<TaskFilter>) => void;
  policy: PolicyContext;
  /** Edit-layout controls (features/layout-edit's `EditControls`) - see the
   *  module doc for why this is a slot, not an import. */
  layoutControls?: ReactNode;
  onNavigateWorkPage?: () => void;
  onNavigateSettings?: () => void;
  onOpenTour?: () => void;
}

function ViewPicker({ campaign, catalog }: { campaign: CampaignOutFull; catalog: Catalog }) {
  const [open, setOpen] = useState(false);
  const selectedViewId = useSessionStore((s) => s.selectedViewId);
  const selectView = useSessionStore((s) => s.selectView);
  const views = campaign.imagery_views;
  const selected = views.find((v: ImageryViewOut) => v.id === selectedViewId);

  if (views.length === 0) return null;

  return (
    <div className="relative" data-tour="imagery-selector">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 desktop:gap-2 px-2 desktop:px-3 py-1.5 text-sm text-neutral-900 hover:bg-neutral-100 rounded transition-colors ${open ? 'bg-neutral-100' : ''}`}
        title={selected ? `View: ${selected.name}` : 'Switch View (u)'}
        data-testid="view-picker-trigger"
      >
        <IconImage className="w-5 h-5" />
        <span className="hidden desktop:inline">{selected ? selected.name : 'Select View'}</span>
        <IconChevronDown className="hidden desktop:block w-4 h-4" />
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
              selectView(
                view.id,
                catalog,
                fallbackCollectionFor(catalog, view.id, view.source_ids)
              );
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
  catalog,
  tasks,
  taskSets,
  taskFilter,
  onTaskFilterChange,
  policy,
  layoutControls,
  onNavigateWorkPage,
  onNavigateSettings,
  onOpenTour,
}: ToolbarProps) {
  const workMode = useSessionStore((s) => s.workMode);
  const isReviewMode = useSessionStore((s) => s.isReviewMode);
  const [taskFilterOpen, setTaskFilterOpen] = useState(false);
  const isFullscreen = useLayoutStore((s) => s.isFullscreen);
  const toggleFullscreen = useLayoutStore((s) => s.toggleFullscreen);

  const hasConflicts = tasks.some((t) => t.task_status === 'conflicting');

  return (
    <header
      data-tour="toolbar"
      className="flex items-center justify-between px-2 desktop:px-4 py-1 bg-white border-b border-neutral-200 flex-shrink-0 gap-1"
    >
      <div className="flex items-center gap-0.5 desktop:gap-2">
        <ModeSwitch campaign={campaign} hasTasks={tasks.length > 0} policy={policy} />

        <ViewPicker campaign={campaign} catalog={catalog} />

        {workMode === 'tasks' && (
          <div className="relative" data-tour="task-filter">
            <button
              type="button"
              onClick={() => setTaskFilterOpen((o) => !o)}
              className={`flex items-center gap-1 desktop:gap-2 px-2 desktop:px-3 py-1.5 text-sm text-neutral-900 hover:bg-neutral-100 rounded transition-colors ${taskFilterOpen ? 'bg-neutral-100' : ''}`}
              title="Filter visible tasks"
              data-testid="task-filter-trigger"
            >
              <IconTaskList className="w-5 h-5" />
              <span className="hidden desktop:inline">Filter Tasks</span>
              <IconChevronDown className="hidden desktop:block w-4 h-4" />
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
              <IconList className="w-4 h-4" />
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
            <IconGear className="w-5 h-5" />
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
            <IconFullscreenExit className="w-5 h-5" />
          ) : (
            <IconFullscreen className="w-5 h-5" />
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
