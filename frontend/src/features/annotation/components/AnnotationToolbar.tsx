import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Layout } from 'react-grid-layout';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { exportAnnotations, exportAnnotationsGeojson } from '~/api/client';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore, type TaskStatus } from '../stores/task.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { useAccountStore } from '~/features/account/account.store';
import { Dropdown } from '~/shared/ui/motion';
import { IconFlag } from '~/shared/ui/Icons';

const KEYBOARD_SHORTCUTS = [
  { key: 'W / S', description: 'Previous / Next task' },
  { key: 'A / D', description: 'Previous / Next slice' },
  { key: 'Shift+A / D', description: 'Previous / Next collection' },
  { key: '↑ ↓ ← ->', description: 'Pan map' },
  { key: 'Alt+↑ / ↓', description: 'Zoom in / out' },
  { key: 'Space', description: 'Recenter maps' },
  { key: 'O', description: 'Toggle crosshair' },
  { key: 'V', description: 'Cycle view' },
  { key: 'L', description: 'Toggle view link (sync windows)' },
  { key: 'I', description: 'Cycle imagery source' },
  { key: 'Shift+I', description: 'Cycle visualization' },
  { key: '1-9, 0', description: 'Select label by number' },
  { key: 'Enter', description: 'Submit annotation' },
  { key: 'B', description: 'Skip annotation' },
  { key: 'F', description: 'Toggle flag for review' },
  { key: 'C', description: 'Focus comment' },
  { key: 'Escape', description: 'Unfocus input' },
  { key: 'G', description: 'Toggle campaign guide' },
  { key: 'H', description: 'Toggle keyboard help' },
];

/**
 * Task filter panel component
 */
const TaskFilterPanel = ({ onClose: _onClose }: { onClose: () => void }) => {
  const campaign = useCampaignStore((s) => s.campaign);
  const isReviewMode = useCampaignStore((s) => s.isReviewMode);
  const allTasks = useTaskStore((s) => s.allTasks);
  const taskFilter = useTaskStore((s) => s.taskFilter);
  const setTaskFilter = useTaskStore((s) => s.setTaskFilter);
  const currentUser = useAccountStore((state) => state.account);

  if (!campaign) return null;

  // Get unique users from tasks - extract from assignments
  const userMap = new Map<string, { id: string; email: string; display_name: string }>();
  allTasks.forEach((task) => {
    const assignments = task.assignments || [];
    assignments.forEach((assignment) => {
      if (!userMap.has(assignment.user_id)) {
        userMap.set(assignment.user_id, {
          id: assignment.user_id,
          email: assignment.user_email || assignment.user_id,
          display_name: assignment.user_display_name || assignment.user_email || assignment.user_id,
        });
      }
    });
  });
  const allUsers = Array.from(userMap.values());

  const handleAssigneeToggle = (userId: string) => {
    const isSelected = taskFilter.assignedTo.includes(userId);
    const newAssignedTo = isSelected
      ? taskFilter.assignedTo.filter((id) => id !== userId)
      : [...taskFilter.assignedTo, userId];

    setTaskFilter({ assignedTo: newAssignedTo });
  };

  const handleStatusToggle = (status: TaskStatus) => {
    const isSelected = taskFilter.statuses.includes(status);
    const newStatuses = isSelected
      ? taskFilter.statuses.filter((s) => s !== status)
      : [...taskFilter.statuses, status];

    if (newStatuses.length > 0) {
      setTaskFilter({ statuses: newStatuses });

      // When selecting 'conflicting', automatically enable review mode and
      // show all users so conflicting tasks from all annotators are visible.
      if (!isSelected && status === 'conflicting') {
        useCampaignStore.setState({ isReviewMode: true });
        if (taskFilter.assignedTo.length > 0) {
          setTaskFilter({ statuses: newStatuses, assignedTo: [] });
          return;
        }
      }
    }
  };

  const handleConfidenceToggle = (value: number) => {
    const isSelected = taskFilter.selectedConfidences.includes(value);
    const next = isSelected
      ? taskFilter.selectedConfidences.filter((c) => c !== value)
      : [...taskFilter.selectedConfidences, value];
    setTaskFilter({ selectedConfidences: next });
  };

  const handleFlaggedToggle = () => {
    setTaskFilter({ flaggedOnly: !taskFilter.flaggedOnly });
  };

  const handleClearReviewFilters = () => {
    setTaskFilter({ selectedConfidences: [], flaggedOnly: false });
  };

  const handleShowAll = () => {
    setTaskFilter({ assignedTo: [] });
  };

  const handleShowMine = () => {
    if (currentUser) {
      setTaskFilter({ assignedTo: [currentUser.id] });
    }
  };

  const isShowingAll = taskFilter.assignedTo.length === 0;
  const isShowingMineOnly =
    taskFilter.assignedTo.length === 1 &&
    currentUser &&
    taskFilter.assignedTo[0] === currentUser.id;

  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-lg min-w-[280px] p-3">
      <div className="space-y-3">
        {/* Assigned To Section */}
        <div>
          <div className="text-xs font-semibold text-neutral-700 mb-2 uppercase tracking-wide">
            Assigned To
          </div>
          <div className="flex gap-2 mb-2">
            <button
              onClick={handleShowAll}
              className={`px-2 py-1 text-xs rounded ${
                isShowingAll
                  ? 'bg-brand-600 text-white'
                  : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
              }`}
            >
              All
            </button>
            {currentUser && (
              <button
                onClick={handleShowMine}
                className={`px-2 py-1 text-xs rounded ${
                  isShowingMineOnly
                    ? 'bg-brand-600 text-white'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                Mine
              </button>
            )}
          </div>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {allUsers.map((user) => (
              <label
                key={user.id}
                className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-neutral-50 rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={
                    taskFilter.assignedTo.length === 0 || taskFilter.assignedTo.includes(user.id)
                  }
                  onChange={() => handleAssigneeToggle(user.id)}
                  disabled={isShowingAll}
                  className="rounded accent-brand-500"
                />
                <span className="text-neutral-900">{user.display_name}</span>
              </label>
            ))}
            {allUsers.length === 0 && (
              <div className="text-xs text-neutral-500 px-2 py-1">No assigned users</div>
            )}
          </div>
        </div>

        {/* Status Section */}
        <div className="border-t border-neutral-200 pt-3">
          <div className="text-xs font-semibold text-neutral-700 mb-2 uppercase tracking-wide">
            Status
          </div>
          <div className="space-y-1">
            {(
              (isReviewMode
                ? [
                    { value: 'pending', label: 'Pending' },
                    { value: 'partial', label: 'Partial' },
                    { value: 'done', label: 'Done' },
                    { value: 'skipped', label: 'Skipped' },
                    { value: 'conflicting', label: 'Conflicting' },
                  ]
                : [
                    { value: 'pending', label: 'Pending' },
                    { value: 'done', label: 'Done' },
                    { value: 'skipped', label: 'Skipped' },
                  ]) as { value: TaskStatus; label: string }[]
            ).map(({ value, label }) => (
              <label
                key={value}
                className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-neutral-50 rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={taskFilter.statuses.includes(value)}
                  onChange={() => handleStatusToggle(value)}
                  className="rounded accent-brand-500"
                />
                <span className="text-neutral-900">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {isReviewMode && (
          <div className="border-t border-neutral-200 pt-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-neutral-700 uppercase tracking-wide">
                Review filters
              </div>
              {(taskFilter.selectedConfidences.length > 0 || taskFilter.flaggedOnly) && (
                <button
                  type="button"
                  onClick={handleClearReviewFilters}
                  className="text-[10px] text-neutral-500 hover:text-neutral-700"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="mb-2">
              <div className="text-[10px] font-medium text-neutral-500 mb-1">Confidence</div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setTaskFilter({ selectedConfidences: [] })}
                  className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                    taskFilter.selectedConfidences.length === 0
                      ? 'bg-brand-600 text-white'
                      : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                  }`}
                >
                  Any
                </button>
                {[1, 2, 3, 4, 5].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => handleConfidenceToggle(c)}
                    className={`w-7 py-0.5 text-[11px] rounded tabular-nums transition-colors ${
                      taskFilter.selectedConfidences.includes(c)
                        ? 'bg-brand-600 text-white'
                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                    }`}
                  >
                    {c}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => handleConfidenceToggle(0)}
                  title="Tasks whose annotations have no confidence rating, or no annotations"
                  className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                    taskFilter.selectedConfidences.includes(0)
                      ? 'bg-brand-600 text-white'
                      : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                  }`}
                >
                  None
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleFlaggedToggle}
              aria-pressed={taskFilter.flaggedOnly}
              title="Show only tasks with at least one flagged annotation"
              className={`flex items-center gap-1.5 px-2 py-1 text-[11px] rounded transition-colors border w-full ${
                taskFilter.flaggedOnly
                  ? 'bg-rose-100 text-rose-800 border-rose-300'
                  : 'bg-neutral-100 text-neutral-700 border-transparent hover:bg-neutral-200'
              }`}
            >
              <IconFlag className="w-3.5 h-3.5" />
              <span>Flagged only</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Toolbar for annotation page with imagery selection and layout controls
 */
export const AnnotationToolbar = () => {
  const navigate = useNavigate();
  const [showImageryDropdown, setShowImageryDropdown] = useState(false);
  const [showTaskFilterDropdown, setShowTaskFilterDropdown] = useState(false);
  const [showSaveDropdown, setShowSaveDropdown] = useState(false);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'geojson' | null>(null);
  const [mergeOnAgreement, setMergeOnAgreement] = useState(false);

  // Conflict-aware merge toggle: any task in 'conflicting' status disables it.
  // Task mode only - open mode never has tasks. Pulled directly from the store.
  const allTasks = useTaskStore((s) => s.allTasks);
  const hasConflicts = allTasks.some((t) => t.task_status === 'conflicting');

  // If conflicts appear while merge is checked, force it back off so we
  // never POST a request the backend will 400 on.
  useEffect(() => {
    if (hasConflicts && mergeOnAgreement) setMergeOnAgreement(false);
  }, [hasConflicts, mergeOnAgreement]);
  const imageryDropdownRef = useRef<HTMLDivElement>(null);
  const taskFilterDropdownRef = useRef<HTMLDivElement>(null);
  const saveDropdownRef = useRef<HTMLDivElement>(null);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  // Get state from store
  const campaign = useCampaignStore((s) => s.campaign);
  const isEditingLayout = useCampaignStore((s) => s.isEditingLayout);
  const isReviewMode = useCampaignStore((s) => s.isReviewMode);
  const isCampaignAdmin = useCampaignStore((s) => s.isCampaignAdmin);
  const selectedViewId = useCampaignStore((s) => s.selectedViewId);
  const setIsEditingLayout = useCampaignStore((s) => s.setIsEditingLayout);
  const saveLayout = useCampaignStore((s) => s.saveLayout);
  const cancelLayoutEdit = useCampaignStore((s) => s.cancelLayoutEdit);
  const resetLayout = useCampaignStore((s) => s.resetLayout);
  const setSelectedViewId = useCampaignStore((s) => s.setSelectedViewId);

  // Get UI actions from global store
  const showAlert = useLayoutStore((state) => state.showAlert);
  const showKeyboardHelp = useLayoutStore((state) => state.showKeyboardHelp);
  const toggleKeyboardHelp = useLayoutStore((state) => state.toggleKeyboardHelp);
  const showGuide = useLayoutStore((state) => state.showGuide);
  const toggleGuide = useLayoutStore((state) => state.toggleGuide);
  const setShowKeyboardHelp = useLayoutStore((state) => state.setShowKeyboardHelp);
  const isFullscreen = useLayoutStore((state) => state.isFullscreen);
  const toggleFullscreen = useLayoutStore((state) => state.toggleFullscreen);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        imageryDropdownRef.current &&
        !imageryDropdownRef.current.contains(event.target as Node)
      ) {
        setShowImageryDropdown(false);
      }
      if (
        taskFilterDropdownRef.current &&
        !taskFilterDropdownRef.current.contains(event.target as Node)
      ) {
        setShowTaskFilterDropdown(false);
      }
      if (saveDropdownRef.current && !saveDropdownRef.current.contains(event.target as Node)) {
        setShowSaveDropdown(false);
      }
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
        setShowExportDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!campaign) return null;

  const views = campaign.imagery_views;
  const selectedView = views.find((v) => v.id === selectedViewId);

  // Check if main layout items have changed
  const hasMainLayoutChanged = () => {
    const { currentLayout, savedLayout } = useCampaignStore.getState();
    if (!currentLayout || !savedLayout) return false;

    const mainItemKeys = ['main', 'timeseries', 'minimap'];
    const currentMainItems = currentLayout.filter((item) => mainItemKeys.includes(item.i));
    const savedMainItems = savedLayout.filter((item) => mainItemKeys.includes(item.i));

    // Compare main layout items
    return JSON.stringify(currentMainItems) !== JSON.stringify(savedMainItems);
  };

  const handleSaveLayout = async (shouldBeDefault: boolean) => {
    // Check if saving as default
    if (shouldBeDefault) {
      const confirmed = await useLayoutStore.getState().showConfirmDialog({
        title: 'Save as Default Layout?',
        description:
          'This will overwrite the default layout for ALL users in this campaign who do not have a personal layout. If you already have a personal layout, it will not be affected. To use the new default layout as your personal layout, apply it now and then hit reset layout and save as personal.',
        confirmText: 'Save Default',
        cancelText: 'Cancel',
        isDangerous: true,
      });
      if (!confirmed) {
        setShowSaveDropdown(false);
        return;
      }
    }

    // Check if main layout changed and there are multiple imagery sources
    if (hasMainLayoutChanged() && views.length > 1) {
      const layoutType = shouldBeDefault ? 'default' : 'personal';
      const confirmed = await useLayoutStore.getState().showConfirmDialog({
        title: 'Main Layout Modified',
        description: `You have modified the main layout (main map, timeseries, or minimap). This change will be applied to ALL imagery sources and may cause layouts to shift.\n\nDo you want to save this ${layoutType} layout?`,
        confirmText: 'Save Layout',
        cancelText: 'Cancel',
      });
      if (!confirmed) {
        setShowSaveDropdown(false);
        return;
      }
    }

    await saveLayout(shouldBeDefault);
    setShowSaveDropdown(false);
  };

  const handleResetLayout = async () => {
    const confirmed = await useLayoutStore.getState().showConfirmDialog({
      title: 'Reset Layout?',
      description: 'This will reset the canvas layout to the campaign defaults.',
      confirmText: 'Reset',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    // Merge main + view layouts (view layout is always created by the backend)
    const mainLayout = campaign.default_main_canvas_layout!.layout_data as Layout;
    const viewLayout = (selectedView?.default_canvas_layout?.layout_data ?? []) as Layout;
    const mergedLayout: Layout = [...mainLayout, ...viewLayout];

    resetLayout(mergedLayout);
    showAlert('Layout reset to defaults', 'success');
  };

  const handleExport = async (format: 'csv' | 'geojson') => {
    if (!campaign) return;
    setExporting(format);
    setShowExportDropdown(false);
    try {
      const fetcher = format === 'geojson' ? exportAnnotationsGeojson : exportAnnotations;
      const response = await fetcher({
        path: { campaign_id: campaign.id },
        query: mergeOnAgreement ? { merge_on_agreement: true } : undefined,
        parseAs: 'blob',
      });

      if (!response.response.ok || !response.data) {
        // Surface the backend's specific error (e.g. conflicting task numbers
        // when merge_on_agreement is rejected).
        let detail = `Failed to export annotations as ${format.toUpperCase()}`;
        try {
          const errBlob = response.data as Blob | undefined;
          if (errBlob) {
            const text = await errBlob.text();
            const parsed = JSON.parse(text) as { detail?: string };
            if (parsed.detail) detail = parsed.detail;
          }
        } catch {
          // body wasn't JSON - fall through with the generic message
        }
        throw new Error(detail);
      }

      const blob = response.data as Blob;
      const ext = format === 'geojson' ? 'geojson' : 'csv';
      const contentDisposition = response.response.headers.get('Content-Disposition');
      let filename = `${campaign.name.replace(/\s+/g, '_')}_annotations.${ext}`;

      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?(.+)"?/i);
        if (match) filename = match[1];
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showAlert(`Annotations exported as ${format.toUpperCase()}`, 'success');
    } catch (err) {
      console.error('Export failed:', err);
      const message = err instanceof Error ? err.message : 'Failed to export annotations';
      showAlert(message, 'error');
    } finally {
      setExporting(null);
    }
  };

  return (
    <header
      data-tour="toolbar"
      className="flex items-center justify-between px-4 py-1 bg-white border-b border-neutral-200 flex-shrink-0"
    >
      <div className="flex items-center gap-2">
        {/* Views Dropdown */}
        <div className="relative" ref={imageryDropdownRef} data-tour="imagery-selector">
          <button
            onClick={() => setShowImageryDropdown(!showImageryDropdown)}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-900 hover:bg-neutral-100 rounded transition-colors ${showImageryDropdown ? 'bg-neutral-100' : ''}`}
            type="button"
            title="Switch View (v)"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3.5 3C2.67157 3 2 3.67157 2 4.5V15.5C2 16.3284 2.67157 17 3.5 17H16.5C17.3284 17 18 16.3284 18 15.5V4.5C18 3.67157 17.3284 3 16.5 3H3.5ZM3 4.5C3 4.22386 3.22386 4 3.5 4H16.5C16.7761 4 17 4.22386 17 4.5V11.7929L14.8536 9.64645C14.6583 9.45118 14.3417 9.45118 14.1464 9.64645L11 12.7929L8.85355 10.6464C8.65829 10.4512 8.34171 10.4512 8.14645 10.6464L3 15.7929V4.5ZM3.20711 16L8 11.2071L10.1464 13.3536C10.3417 13.5488 10.6583 13.5488 10.8536 13.3536L14 10.2071L17 13.2071V15.5C17 15.7761 16.7761 16 16.5 16H3.5C3.39645 16 3.29871 15.9682 3.20711 16ZM13 7.5C13 8.32843 12.3284 9 11.5 9C10.6716 9 10 8.32843 10 7.5C10 6.67157 10.6716 6 11.5 6C12.3284 6 13 6.67157 13 7.5Z" />
            </svg>
            <span>{selectedView ? selectedView.name : 'Select View'}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.29289 6.29289C4.68342 5.90237 5.31658 5.90237 5.70711 6.29289L8 8.58579L10.2929 6.29289C10.6834 5.90237 11.3166 5.90237 11.7071 6.29289C12.0976 6.68342 12.0976 7.31658 11.7071 7.70711L8.70711 10.7071C8.31658 11.0976 7.68342 11.0976 7.29289 10.7071L4.29289 7.70711C3.90237 7.31658 3.90237 6.68342 4.29289 6.29289Z" />
            </svg>
          </button>
          <Dropdown
            open={showImageryDropdown}
            className="absolute top-full left-0 mt-0.5 bg-white border border-neutral-200 rounded-lg shadow-lg z-10 min-w-[200px] max-h-[400px] overflow-y-auto origin-top-left"
          >
            {views.length === 0 ? (
              <div className="px-3 py-2 text-sm text-neutral-500">No views available</div>
            ) : (
              views.map((view) => (
                <button
                  key={view.id}
                  onClick={() => {
                    setSelectedViewId(view.id);
                    setShowImageryDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 transition-colors ${
                    selectedViewId === view.id
                      ? 'bg-neutral-100 text-brand-700 font-medium'
                      : 'text-neutral-900'
                  }`}
                  type="button"
                >
                  <div className="font-medium">{view.name}</div>
                </button>
              ))
            )}
          </Dropdown>
        </div>

        {/* Task Filter Dropdown */}
        {campaign.mode === 'tasks' && (
          <div className="relative" ref={taskFilterDropdownRef} data-tour="task-filter">
            <button
              onClick={() => setShowTaskFilterDropdown(!showTaskFilterDropdown)}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-900 hover:bg-neutral-100 rounded transition-colors ${showTaskFilterDropdown ? 'bg-neutral-100' : ''}`}
              type="button"
              title="Filter visible tasks"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3h9A1.5 1.5 0 0 1 16 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15.5v-11ZM5.5 4a.5.5 0 0 0-.5.5V6h10V4.5a.5.5 0 0 0-.5-.5h-9ZM15 7H5v8.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V7Zm-8 2h6v1H7V9Zm0 2h6v1H7v-1Z" />
              </svg>
              <span>Filter Tasks</span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4.29289 6.29289C4.68342 5.90237 5.31658 5.90237 5.70711 6.29289L8 8.58579L10.2929 6.29289C10.6834 5.90237 11.3166 5.90237 11.7071 6.29289C12.0976 6.68342 12.0976 7.31658 11.7071 7.70711L8.70711 10.7071C8.31658 11.0976 7.68342 11.0976 7.29289 10.7071L4.29289 7.70711C3.90237 7.31658 3.90237 6.68342 4.29289 6.29289Z" />
              </svg>
            </button>
            <Dropdown
              open={showTaskFilterDropdown}
              className="absolute top-full left-0 mt-1 origin-top-left z-20"
            >
              <TaskFilterPanel onClose={() => setShowTaskFilterDropdown(false)} />
            </Dropdown>
          </div>
        )}

        {/* Review Mode Toggle (tasks mode only) + Navigate to Review Page (both modes) */}
        <div className="flex items-center rounded overflow-hidden" data-tour="review-toggle">
          {campaign.mode === 'tasks' && (
            <>
              {/* Toggle review mode on/off */}
              <button
                onClick={() => {
                  const turningOn = !isReviewMode;
                  useCampaignStore.setState({ isReviewMode: turningOn });
                  // When entering review mode, widen the task filter to show
                  // everything except pending. Pending tasks haven't been
                  // labeled by anyone yet so there's nothing to review there,
                  // and the default filter is pending-only which would hide
                  // everything a reviewer actually wants to see.
                  if (turningOn) {
                    useTaskStore.getState().setTaskFilter({
                      assignedTo: [],
                      statuses: ['partial', 'done', 'skipped', 'conflicting'],
                      selectedConfidences: [],
                      flaggedOnly: false,
                    });
                  } else {
                    useTaskStore.getState().setTaskFilter({
                      selectedConfidences: [],
                      flaggedOnly: false,
                    });
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                  isReviewMode
                    ? 'bg-amber-50 text-amber-700 font-medium'
                    : 'text-neutral-700 hover:bg-neutral-50'
                }`}
                type="button"
                title={isReviewMode ? 'Exit review mode' : 'Enter review mode'}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className={isReviewMode ? 'text-amber-600' : 'text-neutral-500'}
                >
                  <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
                  />
                </svg>
                <span>Review{isReviewMode ? ' ✓' : ''}</span>
              </button>
              {/* Divider */}
              <div className="w-px h-5 bg-neutral-200" />
            </>
          )}
          {/* Navigate to review page */}
          <button
            onClick={() => navigate(`/campaigns/${campaign.id}/annotations`)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
            type="button"
            title="Go to review page"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 5A.75.75 0 0 1 2.75 9h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 9.75Zm0 5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z"
              />
            </svg>
            {campaign.mode !== 'tasks' && <span>Review</span>}
          </button>
        </div>

        {/* Campaign Settings Button (admin only) */}
        {isCampaignAdmin && (
          <button
            onClick={() => navigate(`/campaigns/${campaign.id}/settings`)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-700 bg-white hover:bg-neutral-50 rounded transition-colors"
            type="button"
            title="Campaign Settings"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
              className="shrink-0 transition text-text-400 group-hover:text-text-100 cursor-pointer"
            >
              <path d="M10.75 2C10.75 1.58579 10.4142 1.25 10 1.25C9.58579 1.25 9.25 1.58579 9.25 2V3.01564C8.37896 3.10701 7.55761 3.36516 6.82036 3.75532L6.06066 2.99563C5.76777 2.70274 5.29289 2.70274 5 2.99563C4.70711 3.28853 4.70711 3.7634 5 4.0563L5.75968 4.81598C5.36953 5.55323 5.11138 6.37458 5.02001 7.24562H4C3.58579 7.24562 3.25 7.58141 3.25 7.99562C3.25 8.40984 3.58579 8.74562 4 8.74562H5.02001C5.11138 9.61667 5.36953 10.438 5.75968 11.1753L5 11.9349C4.70711 12.2278 4.70711 12.7027 5 12.9956C5.29289 13.2885 5.76777 13.2885 6.06066 12.9956L6.82036 12.2359C7.55761 12.6261 8.37896 12.8842 9.25 12.9756V14C9.25 14.4142 9.58579 14.75 10 14.75C10.4142 14.75 10.75 14.4142 10.75 14V12.9756C11.621 12.8842 12.4424 12.6261 13.1796 12.2359L13.9393 12.9956C14.2322 13.2885 14.7071 13.2885 15 12.9956C15.2929 12.7027 15.2929 12.2278 15 11.9349L14.2403 11.1753C14.6305 10.438 14.8886 9.61667 14.98 8.74562H16C16.4142 8.74562 16.75 8.40984 16.75 7.99562C16.75 7.58141 16.4142 7.24562 16 7.24562H14.98C14.8886 6.37458 14.6305 5.55323 14.2403 4.81598L15 4.0563C15.2929 3.7634 15.2929 3.28853 15 2.99563C14.7071 2.70274 14.2322 2.70274 13.9393 2.99563L13.1796 3.75532C12.4424 3.36516 11.621 3.10701 10.75 3.01564V2ZM10 11.4956C8.20507 11.4956 6.75 10.0406 6.75 8.24562C6.75 6.45069 8.20507 4.99562 10 4.99562C11.7949 4.99562 13.25 6.45069 13.25 8.24562C13.25 10.0406 11.7949 11.4956 10 11.4956ZM10 9.99562C11.1046 9.99562 12 9.10019 12 7.99562C12 6.89105 11.1046 5.99562 10 5.99562C8.89543 5.99562 8 6.89105 8 7.99562C8 9.10019 8.89543 9.99562 10 9.99562Z"></path>
            </svg>
            <span>Settings</span>
          </button>
        )}

        {/* Export Dropdown */}
        <div className="relative" ref={exportDropdownRef}>
          <button
            onClick={() => setShowExportDropdown(!showExportDropdown)}
            disabled={exporting !== null}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 rounded transition-colors ${showExportDropdown ? 'bg-neutral-100' : ''} ${exporting ? 'opacity-50 cursor-not-allowed' : ''}`}
            type="button"
            title="Export annotations"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
              <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
            </svg>
            <span>{exporting ? 'Exporting…' : 'Export'}</span>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.29289 6.29289C4.68342 5.90237 5.31658 5.90237 5.70711 6.29289L8 8.58579L10.2929 6.29289C10.6834 5.90237 11.3166 5.90237 11.7071 6.29289C12.0976 6.68342 12.0976 7.31658 11.7071 7.70711L8.70711 10.7071C8.31658 11.0976 7.68342 11.0976 7.29289 10.7071L4.29289 7.70711C3.90237 7.31658 3.90237 6.68342 4.29289 6.29289Z" />
            </svg>
          </button>
          <Dropdown
            open={showExportDropdown}
            className="absolute top-full left-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-20 min-w-[240px] origin-top-left"
          >
            {campaign?.mode === 'tasks' && (
              <label
                className={`flex items-start gap-2 px-3 py-2 border-b border-neutral-200 ${
                  hasConflicts
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer hover:bg-neutral-50'
                }`}
                title={
                  hasConflicts
                    ? 'Disabled: this campaign has conflicting tasks. Resolve them in review mode before merging on agreement.'
                    : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={mergeOnAgreement}
                  disabled={hasConflicts}
                  onChange={(e) => setMergeOnAgreement(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-[11px] leading-snug text-neutral-700">
                  <span className="font-medium block">Merge on agreement</span>
                  <span className="text-neutral-500">
                    {hasConflicts
                      ? 'Disabled - resolve conflicting tasks first.'
                      : 'Collapse multi-annotator tasks into one row when all agree.'}
                  </span>
                </span>
              </label>
            )}
            <button
              onClick={() => handleExport('geojson')}
              className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-100 transition-colors text-neutral-900"
              type="button"
            >
              <div className="font-medium">GeoJSON</div>
              <div className="text-[10px] text-neutral-500">FeatureCollection (.geojson)</div>
            </button>
            <button
              onClick={() => handleExport('csv')}
              className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-100 transition-colors text-neutral-900 border-t border-neutral-200"
              type="button"
            >
              <div className="font-medium">CSV</div>
              <div className="text-[10px] text-neutral-500">Tabular export (.csv)</div>
            </button>
          </Dropdown>
        </div>
      </div>

      {/* Right - Layout Controls */}
      <div className="flex items-center gap-2" data-tour="layout-controls">
        {!isEditingLayout ? (
          <button
            onClick={() => setIsEditingLayout(true)}
            title="Edit canvas layout and windows"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 rounded transition-all"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            Edit Layout
          </button>
        ) : (
          <div className="flex items-center gap-1 bg-neutral-50 rounded px-1">
            {/* Save Dropdown */}
            <div className="relative" ref={saveDropdownRef}>
              <button
                onClick={() => setShowSaveDropdown(!showSaveDropdown)}
                className="px-3 py-1 text-xs font-medium text-brand-800 hover:text-brand-600 flex items-center gap-1"
                type="button"
              >
                Save
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4.29289 6.29289C4.68342 5.90237 5.31658 5.90237 5.70711 6.29289L8 8.58579L10.2929 6.29289C10.6834 5.90237 11.3166 5.90237 11.7071 6.29289C12.0976 6.68342 12.0976 7.31658 11.7071 7.70711L8.70711 10.7071C8.31658 11.0976 7.68342 11.0976 7.29289 10.7071L4.29289 7.70711C3.90237 7.31658 3.90237 6.68342 4.29289 6.29289Z" />
                </svg>
              </button>
              <Dropdown
                open={showSaveDropdown}
                className="absolute top-full left-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-20 min-w-[160px] origin-top-left"
              >
                <button
                  onClick={() => handleSaveLayout(false)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-100 transition-colors text-neutral-900"
                  type="button"
                >
                  <div className="font-medium">Save as personal</div>
                  <div className="text-[10px] text-neutral-500">Only for you</div>
                </button>
                {isCampaignAdmin && (
                  <button
                    onClick={() => handleSaveLayout(true)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-100 transition-colors text-neutral-900 border-t border-neutral-200"
                    type="button"
                  >
                    <div className="font-medium">Save as default</div>
                    <div className="text-[10px] text-neutral-500">For all users</div>
                  </button>
                )}
              </Dropdown>
            </div>
            <button
              onClick={handleResetLayout}
              className="px-3 py-1 text-xs font-medium text-brand-800 hover:text-amber-600"
            >
              Reset
            </button>
            <button
              onClick={cancelLayoutEdit}
              className="px-3 py-1 text-xs font-medium text-brand-800 hover:text-red-600"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Fullscreen Toggle */}
        <button
          onClick={toggleFullscreen}
          className="flex items-center justify-center w-8 h-8 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
          title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          type="button"
        >
          {isFullscreen ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3.5 2C3.22386 2 3 2.22386 3 2.5V7.5C3 7.77614 3.22386 8 3.5 8C3.77614 8 4 7.77614 4 7.5V3.70711L7.14645 6.85355C7.34171 7.04882 7.65829 7.04882 7.85355 6.85355C8.04882 6.65829 8.04882 6.34171 7.85355 6.14645L4.70711 3H8.5C8.77614 3 9 2.77614 9 2.5C9 2.22386 8.77614 2 8.5 2H3.5ZM11 2.5C11 2.22386 11.2239 2 11.5 2H16.5C16.7761 2 17 2.22386 17 2.5V7.5C17 7.77614 16.7761 8 16.5 8C16.2239 8 16 7.77614 16 7.5V3.70711L12.8536 6.85355C12.6583 7.04882 12.3417 7.04882 12.1464 6.85355C11.9512 6.65829 11.9512 6.34171 12.1464 6.14645L15.2929 3H11.5C11.2239 3 11 2.77614 11 2.5ZM3.5 12C3.77614 12 4 12.2239 4 12.5V16.2929L7.14645 13.1464C7.34171 12.9512 7.65829 12.9512 7.85355 13.1464C8.04882 13.3417 8.04882 13.6583 7.85355 13.8536L4.70711 17H8.5C8.77614 17 9 17.2239 9 17.5C9 17.7761 8.77614 18 8.5 18H3.5C3.22386 18 3 17.7761 3 17.5V12.5C3 12.2239 3.22386 12 3.5 12ZM16.5 12C16.7761 12 17 12.2239 17 12.5V17.5C17 17.7761 16.7761 18 16.5 18H11.5C11.2239 18 11 17.7761 11 17.5C11 17.2239 11.2239 17 11.5 17H15.2929L12.1464 13.8536C11.9512 13.6583 11.9512 13.3417 12.1464 13.1464C12.3417 12.9512 12.6583 12.9512 12.8536 13.1464L16 16.2929V12.5C16 12.2239 16.2239 12 16.5 12Z" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2.5 3C2.22386 3 2 3.22386 2 3.5V8.5C2 8.77614 2.22386 9 2.5 9C2.77614 9 3 8.77614 3 8.5V4.70711L6.64645 8.35355C6.84171 8.54882 7.15829 8.54882 7.35355 8.35355C7.54882 8.15829 7.54882 7.84171 7.35355 7.64645L3.70711 4H7.5C7.77614 4 8 3.77614 8 3.5C8 3.22386 7.77614 3 7.5 3H2.5ZM12 3.5C12 3.22386 12.2239 3 12.5 3H17.5C17.7761 3 18 3.22386 18 3.5V8.5C18 8.77614 17.7761 9 17.5 9C17.2239 9 17 8.77614 17 8.5V4.70711L13.3536 8.35355C13.1583 8.54882 12.8417 8.54882 12.6464 8.35355C12.4512 8.15829 12.4512 7.84171 12.6464 7.64645L16.2929 4H12.5C12.2239 4 12 3.77614 12 3.5ZM2.5 11C2.77614 11 3 11.2239 3 11.5V15.2929L6.64645 11.6464C6.84171 11.4512 7.15829 11.4512 7.35355 11.6464C7.54882 11.8417 7.54882 12.1583 7.35355 12.3536L3.70711 16H7.5C7.77614 16 8 16.2239 8 16.5C8 16.7761 7.77614 17 7.5 17H2.5C2.22386 17 2 16.7761 2 16.5V11.5C2 11.2239 2.22386 11 2.5 11ZM17.5 11C17.7761 11 18 11.2239 18 11.5V16.5C18 16.7761 17.7761 17 17.5 17H12.5C12.2239 17 12 16.7761 12 16.5C12 16.2239 12.2239 16 12.5 16H16.2929L12.6464 12.3536C12.4512 12.1583 12.4512 11.8417 12.6464 11.6464C12.8417 11.4512 13.1583 11.4512 13.3536 11.6464L17 15.2929V11.5C17 11.2239 17.2239 11 17.5 11Z" />
            </svg>
          )}
        </button>

        {/* Guided Tour Button */}
        <button
          onClick={() => useLayoutStore.getState().setShowGuidedTour(true)}
          className="flex items-center justify-center w-8 h-8 text-neutral-500 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"
          title="Take guided tour"
          type="button"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>

        {/* Campaign Guide */}
        <div className="relative" data-tour="campaign-guide">
          <button
            onClick={toggleGuide}
            className={`flex items-center justify-center w-8 h-8 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors ${showGuide ? 'bg-neutral-100' : ''}`}
            title="Campaign guide (G)"
            type="button"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
              <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
            </svg>
          </button>
          <Dropdown
            open={showGuide}
            className="absolute top-full right-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-20 w-[420px] max-h-[70vh] flex flex-col origin-top-right"
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-neutral-100">
              <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                Campaign guide
              </span>
              <button
                onClick={toggleGuide}
                className="text-neutral-400 hover:text-neutral-600"
                type="button"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3">
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['html']}>
                  {campaign.settings?.guide_markdown || 'No guide available for this campaign.'}
                </ReactMarkdown>
              </div>
            </div>
          </Dropdown>
        </div>

        {/* Keyboard Shortcuts Help */}
        <div className="relative" data-tour="keyboard-help">
          <button
            onClick={toggleKeyboardHelp}
            onBlur={() => setTimeout(() => setShowKeyboardHelp(false), 150)}
            className="flex items-center justify-center w-8 h-8 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
            title="Keyboard shortcuts"
            type="button"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            >
              <rect x="2" y="5" width="16" height="11" rx="2" />
              <line x1="5" y1="8.5" x2="7" y2="8.5" />
              <line x1="9" y1="8.5" x2="11" y2="8.5" />
              <line x1="13" y1="8.5" x2="15" y2="8.5" />
              <line x1="5" y1="11.5" x2="7" y2="11.5" />
              <line x1="9" y1="11.5" x2="11" y2="11.5" />
              <line x1="13" y1="11.5" x2="15" y2="11.5" />
              <line x1="7" y1="14" x2="13" y2="14" />
            </svg>
          </button>

          <Dropdown
            open={showKeyboardHelp}
            className="absolute top-full right-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-20 min-w-[220px] max-h-[70vh] overflow-y-auto p-3 origin-top-right"
          >
            <div className="text-[11px] font-medium text-neutral-500 mb-2 uppercase tracking-wider">
              Keyboard shortcuts
            </div>
            {campaign.mode === 'open' ? (
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mt-0.5">
                  Tools
                </div>
                {(
                  [
                    { key: 'V', description: 'Pan tool' },
                    { key: 'R', description: 'Annotate tool' },
                    { key: 'E', description: 'Edit tool' },
                    { key: 'T', description: 'Timeseries probe' },
                    { key: '1-9', description: 'Select label & annotate' },
                    { key: 'F', description: 'Flag selected (edit tool)' },
                    { key: 'Space', description: 'Fit view to annotations' },
                    { key: 'Alt+drag', description: 'Move feature' },
                    { key: 'Escape', description: 'Cancel / deselect edit' },
                  ] as { key: string; description: string }[]
                ).map((shortcut) => (
                  <div key={shortcut.key} className="flex justify-between items-center text-xs">
                    <span className="text-neutral-600">{shortcut.description}</span>
                    <kbd className="ml-2 px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-700">
                      {shortcut.key}
                    </kbd>
                  </div>
                ))}
                <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mt-2">
                  Navigation
                </div>
                {(
                  [
                    { key: 'A / D', description: 'Previous / Next slice' },
                    { key: 'Shift+A / D', description: 'Previous / Next collection' },
                  ] as { key: string; description: string }[]
                ).map((shortcut) => (
                  <div key={shortcut.key} className="flex justify-between items-center text-xs">
                    <span className="text-neutral-600">{shortcut.description}</span>
                    <kbd className="ml-2 px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-700">
                      {shortcut.key}
                    </kbd>
                  </div>
                ))}
                <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mt-2">
                  Map
                </div>
                {(
                  [
                    { key: '↑ ↓ ← →', description: 'Pan map' },
                    { key: 'Alt+↑ / ↓', description: 'Zoom in / out' },
                    { key: 'O', description: 'Toggle crosshair' },
                    { key: 'L', description: 'Toggle view link (sync)' },
                    { key: 'I', description: 'Cycle imagery source' },
                    { key: 'Shift+I', description: 'Cycle visualization' },
                    { key: 'V', description: 'Cycle view' },
                    { key: 'G', description: 'Toggle campaign guide' },
                    { key: 'H', description: 'Toggle keyboard help' },
                  ] as { key: string; description: string }[]
                ).map((shortcut) => (
                  <div key={shortcut.key} className="flex justify-between items-center text-xs">
                    <span className="text-neutral-600">{shortcut.description}</span>
                    <kbd className="ml-2 px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-700">
                      {shortcut.key}
                    </kbd>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1.5">
                {KEYBOARD_SHORTCUTS.map((shortcut) => (
                  <div key={shortcut.key} className="flex justify-between items-center text-xs">
                    <span className="text-neutral-600">{shortcut.description}</span>
                    <kbd className="ml-2 px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-700">
                      {shortcut.key}
                    </kbd>
                  </div>
                ))}
              </div>
            )}
          </Dropdown>
        </div>
      </div>
    </header>
  );
};
