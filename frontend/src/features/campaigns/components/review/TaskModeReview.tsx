import { useEffect, useState, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import {
  getAllAnnotationTasks,
  listTaskSets,
  type AnnotationTaskOut,
  type CampaignOut,
  type TaskSetOut,
} from '~/api/client';
import { useAccountStore } from '~/features/account/account.store';
import {
  countTasksByStatus,
  formatTaskStatus,
  getTaskStatusColor,
} from '~/shared/utils/taskStatus';
import { extractCentroidFromWKT } from '~/shared/utils/utility';
import { handleError } from '~/shared/utils/errorHandler';
import Statistics from './Statistics';
import { AnnotationDistributionMap } from './AnnotationDistributionMap';
import { ExportDropdown } from './ExportDropdown';
import { Button } from '~/shared/ui/forms';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { MoveTasksDialog } from '~/features/campaigns/components/settings/MoveTasksDialog';
import { UserFilterDropdown } from './UserFilterDropdown';
import { IconFlag } from '~/shared/ui/Icons';
import { Tooltip } from '~/shared/ui/Tooltip';
import { isSortOption, type SortOption, type StatusFilter, type UserInfo } from './types';
import { FadeIn } from '~/shared/ui/motion';
import { listRowCls, tableHeadRowCls } from '~/shared/ui/listRow';

/** Funnel icon for the filters dropdown trigger - kept local since Icons.tsx has unrelated WIP. */
const IconFunnel = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path d="M3 4h14l-5.5 6.5V16l-3-1.5v-4L3 4z" />
  </svg>
);

interface TaskModeReviewProps {
  campaign?: CampaignOut;
  campaignId: number;
  /** External task list (e.g. the tasks page's scoped/reloadable set). Omit to have this component fetch and own its data, as on the annotations page. */
  tasks?: AnnotationTaskOut[];
  taskSets?: TaskSetOut[];
  /** Tasks page already provides set scoping via TaskScopeBar; hide this component's own set filter to avoid a redundant control. */
  hideSetFilter?: boolean;
  /** Tasks page already renders its own header, map, and stats; render only the filterable list. */
  embedded?: boolean;
  /** Heading content for the filters row (e.g. the tasks page's "Annotation tasks (N)" h2). Falls back to a local "Filters & search" label. */
  headerSlot?: ReactNode;
  /** Enables row selection and the management action bar (delete/unassign/move/bulk-assign). */
  selectable?: boolean;
  onDeleteTasks?: (taskIds: number[]) => Promise<void>;
  onBatchUnassignTasks?: (taskIds: number[]) => Promise<void>;
  onMoveTasks?: (taskIds: number[], taskSetId: number) => Promise<void>;
  onCreateSet?: (name: string) => Promise<number | null>;
  onAssignSelected?: (taskIds: number[]) => void;
  onOpenBulkAssign?: () => void;
  onOpenReviewerAssign?: () => void;
}

export const TaskModeReview = ({
  campaign,
  campaignId,
  tasks: tasksProp,
  taskSets: taskSetsProp,
  hideSetFilter = false,
  embedded = false,
  headerSlot,
  selectable = false,
  onDeleteTasks,
  onBatchUnassignTasks,
  onMoveTasks,
  onCreateSet,
  onAssignSelected,
  onOpenBulkAssign,
  onOpenReviewerAssign,
}: TaskModeReviewProps) => {
  const navigate = useNavigate();
  const currentUser = useAccountStore((state) => state.account);
  const isExternallyDriven = tasksProp !== undefined;

  const [fetchedTasks, setFetchedTasks] = useState<AnnotationTaskOut[]>([]);
  const [fetchedTaskSets, setFetchedTaskSets] = useState<TaskSetOut[]>([]);
  const [loading, setLoading] = useState(!isExternallyDriven);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedConfidences, setSelectedConfidences] = useState<number[]>([]);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('default');
  const [setFilter, setSetFilter] = useState<number | 'all'>('all');
  const [showFilters, setShowFilters] = useState(false);

  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isBatchUnassigning, setIsBatchUnassigning] = useState(false);
  const [confirmBatchUnassign, setConfirmBatchUnassign] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);

  useEffect(() => {
    if (isExternallyDriven) return;
    const loadTasks = async () => {
      try {
        setLoading(true);
        const [tasksRes, taskSetsRes] = await Promise.all([
          getAllAnnotationTasks({ path: { campaign_id: campaignId } }),
          listTaskSets({ path: { campaign_id: campaignId } }),
        ]);
        setFetchedTasks(tasksRes.data!.tasks);
        setFetchedTaskSets(taskSetsRes.data ?? []);
      } catch (err) {
        handleError(err, 'Failed to load tasks');
      } finally {
        setLoading(false);
      }
    };
    loadTasks();
  }, [campaignId, isExternallyDriven]);

  const tasks = tasksProp ?? fetchedTasks;
  const taskSets = taskSetsProp ?? fetchedTaskSets;

  // Selecting a set that no longer exists (e.g. after a reload) falls back to "all".
  useEffect(() => {
    if (setFilter !== 'all' && !taskSets.some((s) => s.id === setFilter)) {
      setSetFilter('all');
    }
  }, [taskSets, setFilter]);

  const filteredTasks = useMemo(() => {
    const filtered = tasks.filter((task) => {
      if (statusFilter !== 'all' && task.task_status !== statusFilter) return false;
      if (setFilter !== 'all' && task.task_set_id !== setFilter) return false;
      if (selectedUserIds.length > 0) {
        const assignments = task.assignments || [];
        if (!assignments.some((a) => selectedUserIds.includes(a.user_id))) return false;
      }
      if (selectedConfidences.length > 0) {
        const taskConfs = (task.annotations || []).map((a) => a.confidence ?? 0);
        if (taskConfs.length === 0) taskConfs.push(0);
        if (!taskConfs.some((c) => selectedConfidences.includes(c))) return false;
      }
      if (flaggedOnly) {
        if (!(task.annotations || []).some((a) => a.flagged_for_review)) return false;
      }
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (
          !task.id.toString().includes(query) &&
          !task.annotation_number.toString().includes(query)
        )
          return false;
      }
      return true;
    });

    if (sortOption === 'default') return filtered;
    return [...filtered].sort((a, b) => {
      if (sortOption === 'confidence-asc' || sortOption === 'confidence-desc') {
        const getMinConf = (t: AnnotationTaskOut) => {
          if (!t.annotations?.length) return Infinity;
          const vals = t.annotations.map((x) => x.confidence).filter((c): c is number => c != null);
          return vals.length ? Math.min(...vals) : Infinity;
        };
        const ca = getMinConf(a),
          cb = getMinConf(b);
        if (ca === Infinity && cb === Infinity) return 0;
        if (ca === Infinity) return 1;
        if (cb === Infinity) return -1;
        return sortOption === 'confidence-asc' ? ca - cb : cb - ca;
      }
      if (sortOption === 'id-asc') return a.annotation_number - b.annotation_number;
      if (sortOption === 'id-desc') return b.annotation_number - a.annotation_number;
      return 0;
    });
  }, [
    tasks,
    statusFilter,
    setFilter,
    selectedUserIds,
    selectedConfidences,
    flaggedOnly,
    searchQuery,
    sortOption,
  ]);

  // Selected ids must never outlive the rows on screen: filter changes and data
  // reloads swap filteredTasks, and batch actions act on raw ids server-side.
  useEffect(() => {
    if (!selectable) return;
    setSelectedTasks((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(filteredTasks.map((t) => t.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredTasks, selectable]);

  const uniqueUsers = useMemo(() => {
    const m = new Map<string, UserInfo>();
    tasks.forEach((t) => {
      t.assignments?.forEach((a) => {
        if (!m.has(a.user_id))
          m.set(a.user_id, {
            id: a.user_id,
            email: a.user_email || null,
            displayName: a.user_display_name || null,
          });
      });
      t.annotations?.forEach((ann) => {
        if (!m.has(ann.created_by_user_id)) {
          m.set(ann.created_by_user_id, {
            id: ann.created_by_user_id,
            email: ann.created_by_user_email ?? null,
            displayName: ann.created_by_user_display_name ?? null,
          });
        }
      });
    });
    return Array.from(m.values()).sort((a, b) =>
      (a.displayName || a.email || a.id).localeCompare(b.displayName || b.email || b.id)
    );
  }, [tasks]);

  const stats = useMemo(() => ({ total: tasks.length, ...countTasksByStatus(tasks) }), [tasks]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (statusFilter !== 'all') count++;
    if (setFilter !== 'all') count++;
    if (selectedUserIds.length > 0) count++;
    if (selectedConfidences.length > 0) count++;
    if (flaggedOnly) count++;
    return count;
  }, [statusFilter, setFilter, selectedUserIds, selectedConfidences, flaggedOnly]);

  const handleNavigateToTask = (taskId: number) => {
    navigate(`/campaigns/${campaignId}/annotate?task=${taskId}&review=true`);
  };

  const handleToggleTask = (taskId: number) => {
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedTasks.size === filteredTasks.length) {
      setSelectedTasks(new Set());
    } else {
      setSelectedTasks(new Set(filteredTasks.map((t) => t.id)));
    }
  };

  const handleDeleteSelected = async () => {
    if (!onDeleteTasks || selectedTasks.size === 0) return;
    try {
      setIsDeleting(true);
      await onDeleteTasks(Array.from(selectedTasks));
      setSelectedTasks(new Set());
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  const selectedTasksHaveAssignments = filteredTasks.some(
    (t) => selectedTasks.has(t.id) && t.assignments && t.assignments.length > 0
  );

  const handleBatchUnassignSelected = async () => {
    if (!onBatchUnassignTasks || selectedTasks.size === 0) return;
    try {
      setIsBatchUnassigning(true);
      await onBatchUnassignTasks(Array.from(selectedTasks));
      setSelectedTasks(new Set());
    } finally {
      setIsBatchUnassigning(false);
      setConfirmBatchUnassign(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading tasks..." />
      </div>
    );
  }

  const capitalizeFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  return (
    <div className={embedded ? undefined : 'flex-1 overflow-auto'}>
      <FadeIn className={embedded ? undefined : 'page'}>
        {!embedded && campaign && (
          <header className="page-header">
            <div>
              <h1 className="page-title">{capitalizeFirst(campaign.name)} - Annotations</h1>
              <p className="page-subtitle">
                View and filter all annotation tasks for this campaign.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <ExportDropdown
                campaignId={campaignId}
                campaign={campaign}
                disabled={tasks.length === 0}
                hasConflicts={tasks.some((t) => t.task_status === 'conflicting')}
              />
              <Button onClick={() => navigate(`/campaigns/${campaignId}/annotate`)}>
                Start annotating
              </Button>
            </div>
          </header>
        )}

        {/* Map - sits above the surface, no card wrapper */}
        {!embedded && campaign && tasks.length > 0 && (
          <div className="mb-6">
            <AnnotationDistributionMap
              tasks={tasks}
              labels={campaign.settings.labels}
              bbox={{
                west: campaign.settings.bbox_west,
                south: campaign.settings.bbox_south,
                east: campaign.settings.bbox_east,
                north: campaign.settings.bbox_north,
              }}
            />
          </div>
        )}

        {/* Statistics */}
        {!embedded && tasks.length > 0 && <Statistics campaignId={campaignId} />}

        {/* Filters - embedded (tasks page) sits flat on the page; standalone keeps its own surface */}
        <div className={embedded ? undefined : 'surface surface-unclipped'}>
          <div className={embedded ? 'space-y-3' : 'px-5 py-4 space-y-3'}>
            <div className="flex items-center gap-2">
              {headerSlot ?? <h3 className="section-heading">Filters & search</h3>}
              <button
                onClick={() => setShowFilters((v) => !v)}
                className="relative h-8 w-8 inline-flex items-center justify-center rounded text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100"
                title="Filter and sort"
                type="button"
              >
                <IconFunnel className="w-4 h-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 text-[10px] font-semibold rounded-full bg-brand-600 text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>

            {/* Stats stay visible regardless of the filter panel's collapsed state. */}
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span>
                Showing {filteredTasks.length} of {tasks.length} tasks
              </span>
              <div className="flex items-center gap-4">
                <span>
                  Complete: <strong className="text-neutral-800">{stats.done}</strong>
                </span>
                <span>
                  Partial: <strong className="text-neutral-800">{stats.partial}</strong>
                </span>
                <span>
                  Conflicting: <strong className="text-neutral-800">{stats.conflicting}</strong>
                </span>
                <span>
                  Pending: <strong className="text-neutral-800">{stats.pending}</strong>
                </span>
                <span>
                  Skipped: <strong className="text-neutral-800">{stats.skipped}</strong>
                </span>
              </div>
            </div>

            {showFilters && (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-3 space-y-3">
                {/* Search */}
                <div>
                  <div className="text-xs font-semibold text-neutral-700 mb-2 uppercase tracking-wide">
                    Search
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Search by ID or annotation #..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-600 w-64"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="text-neutral-500 hover:text-neutral-700"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Status Filter */}
                <div className="border-t border-neutral-200 pt-3">
                  <div className="text-xs font-semibold text-neutral-700 mb-2 uppercase tracking-wide">
                    Status
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        'all',
                        'pending',
                        'partial',
                        'conflicting',
                        'done',
                        'skipped',
                      ] as StatusFilter[]
                    ).map((status) => (
                      <button
                        key={status}
                        onClick={() => setStatusFilter(status)}
                        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                          statusFilter === status
                            ? 'bg-brand-600 text-white'
                            : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                        }`}
                      >
                        {status === 'all' ? 'All' : capitalizeFirst(status)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Set Filter */}
                {!hideSetFilter && taskSets.length > 1 && (
                  <div className="border-t border-neutral-200 pt-3">
                    <div className="text-xs font-semibold text-neutral-700 mb-2 uppercase tracking-wide">
                      Set
                    </div>
                    <select
                      data-testid="review-set-filter"
                      value={setFilter}
                      onChange={(e) =>
                        setSetFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
                      }
                      className="w-full px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                    >
                      <option value="all">All sets</option>
                      {taskSets.map((set) => (
                        <option key={set.id} value={set.id}>
                          {set.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* User Filter */}
                <div className="border-t border-neutral-200 pt-3">
                  <UserFilterDropdown
                    users={uniqueUsers}
                    selectedUserIds={selectedUserIds}
                    setSelectedUserIds={setSelectedUserIds}
                    currentUserId={currentUser?.id}
                  />
                </div>

                {/* Confidence Filter */}
                <div className="border-t border-neutral-200 pt-3">
                  <div className="text-xs font-semibold text-neutral-700 mb-2 uppercase tracking-wide">
                    Confidence
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      onClick={() => setSelectedConfidences([])}
                      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                        selectedConfidences.length === 0
                          ? 'bg-brand-600 text-white'
                          : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                      }`}
                    >
                      All
                    </button>
                    {[1, 2, 3, 4, 5].map((c) => (
                      <button
                        key={c}
                        onClick={() =>
                          setSelectedConfidences(
                            selectedConfidences.includes(c)
                              ? selectedConfidences.filter((x) => x !== c)
                              : [...selectedConfidences, c]
                          )
                        }
                        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                          selectedConfidences.includes(c)
                            ? 'bg-brand-600 text-white'
                            : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                    <button
                      onClick={() =>
                        setSelectedConfidences(
                          selectedConfidences.includes(0)
                            ? selectedConfidences.filter((x) => x !== 0)
                            : [...selectedConfidences, 0]
                        )
                      }
                      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                        selectedConfidences.includes(0)
                          ? 'bg-brand-600 text-white'
                          : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                      }`}
                      title="Tasks with annotations missing a confidence rating, or no annotations"
                    >
                      No rating
                    </button>
                  </div>
                </div>

                {/* Flagged Filter */}
                <div className="border-t border-neutral-200 pt-3">
                  <button
                    onClick={() => setFlaggedOnly((v) => !v)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors border w-full ${
                      flaggedOnly
                        ? 'bg-rose-100 text-rose-800 border-rose-300'
                        : 'bg-neutral-100 text-neutral-700 border-transparent hover:bg-neutral-200'
                    }`}
                    title="Show only tasks with at least one flagged annotation"
                  >
                    <IconFlag className="w-3.5 h-3.5" />
                    <span>Flagged only</span>
                  </button>
                </div>

                {/* Sort */}
                <div className="border-t border-neutral-200 pt-3">
                  <div className="text-xs font-semibold text-neutral-700 mb-2 uppercase tracking-wide">
                    Sort by
                  </div>
                  <select
                    value={sortOption}
                    onChange={(e) => {
                      if (isSortOption(e.target.value)) setSortOption(e.target.value);
                    }}
                    className="w-full px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                  >
                    <option value="default">Default</option>
                    <option value="confidence-asc">Confidence (Low to High)</option>
                    <option value="confidence-desc">Confidence (High to Low)</option>
                    <option value="id-asc">Annotation # (Ascending)</option>
                    <option value="id-desc">Annotation # (Descending)</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tasks Table */}
        <div className="mt-6">
          {selectable && (
            <div className="flex items-center justify-between mb-4">
              {/* Left: selection-scoped actions, constructive-to-destructive */}
              <div className="flex items-center gap-3">
                {selectedTasks.size > 0 && (
                  <span className="text-xs text-neutral-500">{selectedTasks.size} selected</span>
                )}
                <div className="flex items-center gap-2">
                  {onAssignSelected && (
                    <Button
                      variant="secondary"
                      onClick={() => onAssignSelected(Array.from(selectedTasks))}
                      disabled={selectedTasks.size === 0 || isDeleting || isBatchUnassigning}
                    >
                      Assign selected
                    </Button>
                  )}
                  {onMoveTasks && taskSets.length > 1 && (
                    <Button
                      variant="secondary"
                      onClick={() => setShowMoveDialog(true)}
                      disabled={selectedTasks.size === 0}
                    >
                      Move to set
                    </Button>
                  )}
                  {onBatchUnassignTasks && (
                    <Button
                      variant="secondary"
                      onClick={() => setConfirmBatchUnassign(true)}
                      disabled={
                        selectedTasks.size === 0 ||
                        !selectedTasksHaveAssignments ||
                        isDeleting ||
                        isBatchUnassigning
                      }
                      title={
                        selectedTasks.size === 0
                          ? 'Select tasks to unassign'
                          : !selectedTasksHaveAssignments
                            ? 'Selected tasks have no assignments'
                            : undefined
                      }
                    >
                      {isBatchUnassigning ? 'Unassigning…' : 'Unassign selected'}
                    </Button>
                  )}
                  {onDeleteTasks && (
                    <Button
                      variant="dangerQuiet"
                      onClick={() => setConfirmDelete(true)}
                      disabled={selectedTasks.size === 0 || isDeleting || isBatchUnassigning}
                    >
                      Delete selected
                    </Button>
                  )}
                </div>
              </div>

              {/* Right: pool-wide actions */}
              <div className="flex items-center gap-2">
                {onOpenBulkAssign && (
                  <Button
                    variant="secondary"
                    onClick={onOpenBulkAssign}
                    disabled={isDeleting || isBatchUnassigning}
                  >
                    Assign all
                  </Button>
                )}
                {onOpenReviewerAssign && (
                  <Button
                    variant="secondary"
                    onClick={onOpenReviewerAssign}
                    disabled={isDeleting || isBatchUnassigning}
                  >
                    Set up reviews
                  </Button>
                )}
              </div>
            </div>
          )}

          {filteredTasks.length === 0 ? (
            <div
              className={
                embedded
                  ? 'text-center py-12'
                  : 'text-center py-12 bg-white border border-neutral-200 rounded-xl shadow-sm'
              }
            >
              <svg
                className="w-12 h-12 text-neutral-400 mx-auto mb-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              <p className="text-neutral-700 mb-2">No tasks match your filters</p>
              <p className="text-neutral-500 text-sm">Try adjusting your filter criteria</p>
            </div>
          ) : (
            <div
              className={
                embedded
                  ? 'overflow-x-auto'
                  : 'overflow-x-auto border border-neutral-200 rounded-xl shadow-sm bg-white'
              }
            >
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className={tableHeadRowCls}>
                    {selectable && (
                      <th className="px-4 py-3 text-left w-8">
                        <input
                          type="checkbox"
                          checked={
                            selectedTasks.size === filteredTasks.length && filteredTasks.length > 0
                          }
                          onChange={handleSelectAll}
                          className="w-4 h-4 text-brand-600 rounded focus:ring-brand-600"
                        />
                      </th>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">
                      Annotation #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">
                      Coordinates
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">
                      Annotations
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map((task, index) => {
                    const latLon = extractCentroidFromWKT(task.geometry.geometry);
                    const taskStatus = task.task_status ?? 'pending';
                    const assignments = task.assignments || [];
                    const annotations = task.annotations || [];
                    const isAssignedToMe =
                      currentUser && assignments.some((a) => a.user_id === currentUser.id);
                    const isSelected = selectable && selectedTasks.has(task.id);

                    return (
                      <tr
                        key={task.id}
                        className={listRowCls(index, {
                          tinted: Boolean(isAssignedToMe),
                          selected: isSelected,
                        })}
                      >
                        {selectable && (
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedTasks.has(task.id)}
                              onChange={() => handleToggleTask(task.id)}
                              className="w-4 h-4 text-brand-600 rounded focus:ring-brand-600"
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 text-neutral-900 font-medium">
                          {task.annotation_number}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-1 rounded text-xs font-medium capitalize ${getTaskStatusColor(taskStatus)}`}
                          >
                            {formatTaskStatus(taskStatus)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-neutral-900 text-xs font-mono">
                          {latLon ? `${latLon.lat.toFixed(5)}, ${latLon.lon.toFixed(5)}` : '-'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {annotations.length > 0 ? (
                              annotations.map((ann) => {
                                const annotator = assignments.find(
                                  (a) => a.user_id === ann.created_by_user_id
                                );
                                const isCurrentUser = ann.created_by_user_id === currentUser?.id;
                                const displayName = isCurrentUser
                                  ? currentUser.display_name || currentUser.email || 'You'
                                  : ann.created_by_user_display_name ||
                                    ann.created_by_user_email ||
                                    annotator?.user_display_name ||
                                    annotator?.user_email ||
                                    ann.created_by_user_id?.substring(0, 8) ||
                                    'Unknown';

                                const assignmentForAnn = assignments.find(
                                  (a) => a.user_id === ann.created_by_user_id
                                );
                                const isSkippedAnn =
                                  assignmentForAnn?.status === 'skipped' || ann.label_id == null;
                                const label = ann.label_id
                                  ? `#${ann.label_id}`
                                  : isSkippedAnn
                                    ? 'Skipped'
                                    : '-';
                                const confidence =
                                  ann.confidence != null ? `${ann.confidence}/5` : '-';
                                const hasComment = ann.comment && ann.comment.trim() !== '';
                                const isExtra = ann.counts_toward_completion === false;

                                return (
                                  <div
                                    key={ann.id}
                                    className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${ann.flagged_for_review ? 'bg-rose-50 text-rose-800 border border-rose-300' : isSkippedAnn ? 'bg-violet-100 text-violet-700' : 'bg-neutral-100 text-neutral-700'} ${isExtra ? 'opacity-60' : ''}`}
                                  >
                                    {ann.flagged_for_review && (
                                      <span
                                        className="text-rose-600"
                                        title={ann.flag_comment || 'Flagged for review'}
                                      >
                                        <IconFlag className="w-3.5 h-3.5" />
                                      </span>
                                    )}
                                    <span className="font-medium" title="Annotator">
                                      {displayName}
                                    </span>
                                    {isExtra && (
                                      <>
                                        <span className="text-neutral-400">|</span>
                                        <span
                                          className="px-1 py-0.5 rounded bg-neutral-200 text-neutral-500 text-[9px] font-semibold uppercase tracking-wide"
                                          title="Does not count toward completion"
                                        >
                                          extra
                                        </span>
                                      </>
                                    )}
                                    <span className="text-neutral-400">|</span>
                                    <span title="Label ID">{label}</span>
                                    <span className="text-neutral-400">|</span>
                                    <span
                                      className={ann.confidence != null ? 'font-bold' : ''}
                                      title="Confidence rating"
                                    >
                                      {confidence}
                                    </span>
                                    {hasComment && (
                                      <>
                                        <span className="text-neutral-400">|</span>
                                        <Tooltip text={ann.comment ?? ''}>
                                          <svg
                                            className="w-3.5 h-3.5"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth={2}
                                              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                                            />
                                          </svg>
                                        </Tooltip>
                                      </>
                                    )}
                                  </div>
                                );
                              })
                            ) : (
                              <span className="text-xs text-neutral-400">-</span>
                            )}
                            {/* Placeholder labels for assigned users who haven't annotated yet */}
                            {assignments
                              .filter(
                                (a) =>
                                  a.status === 'pending' &&
                                  !annotations.some((ann) => ann.created_by_user_id === a.user_id)
                              )
                              .map((a) => {
                                const isCurrentUser = a.user_id === currentUser?.id;
                                const displayName = isCurrentUser
                                  ? currentUser.display_name || currentUser.email || 'You'
                                  : a.user_display_name ||
                                    a.user_email ||
                                    a.user_id.substring(0, 8);
                                return (
                                  <div
                                    key={`pending-${a.user_id}`}
                                    className="text-xs px-2 py-1 rounded inline-flex items-center gap-1 border border-dashed border-neutral-300 text-neutral-400 bg-neutral-50"
                                    title="Assigned but not yet annotated"
                                  >
                                    <span className="font-medium">{displayName}</span>
                                    <span className="text-neutral-300">|</span>
                                    <span className="italic">Awaiting</span>
                                  </div>
                                );
                              })}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleNavigateToTask(task.id)}
                            className="text-brand-700 hover:text-brand-900 text-sm font-medium transition-colors"
                          >
                            {taskStatus === 'pending' || taskStatus === 'skipped'
                              ? 'Annotate'
                              : 'View'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer Stats */}
          {filteredTasks.length > 0 &&
            (() => {
              const counts = countTasksByStatus(filteredTasks);
              return (
                <div className="mt-4 flex items-center gap-6 text-sm text-neutral-600">
                  <span>
                    Filtered: <strong className="text-neutral-900">{filteredTasks.length}</strong>
                  </span>
                  <span>
                    Complete: <strong className="text-neutral-900">{counts.done}</strong>
                  </span>
                  <span>
                    Partial: <strong className="text-neutral-900">{counts.partial}</strong>
                  </span>
                  <span>
                    Conflicting: <strong className="text-neutral-900">{counts.conflicting}</strong>
                  </span>
                  <span>
                    Pending: <strong className="text-neutral-900">{counts.pending}</strong>
                  </span>
                  <span>
                    Skipped: <strong className="text-neutral-900">{counts.skipped}</strong>
                  </span>
                </div>
              );
            })()}
        </div>

        {selectable && (
          <>
            <ConfirmDialog
              isOpen={confirmDelete}
              title="Delete selected tasks?"
              description={`This will permanently delete ${selectedTasks.size} selected task(s) and their existing annotations. This action cannot be undone.`}
              confirmText="Delete"
              cancelText="Cancel"
              isDangerous
              isLoading={isDeleting}
              onConfirm={handleDeleteSelected}
              onCancel={() => setConfirmDelete(false)}
            />

            <ConfirmDialog
              isOpen={confirmBatchUnassign}
              title="Unassign selected tasks?"
              description={`This will remove all user assignments from ${selectedTasks.size} selected task(s). Annotations already submitted are preserved. This action cannot be undone.`}
              confirmText="Unassign"
              cancelText="Cancel"
              isDangerous
              isLoading={isBatchUnassigning}
              onConfirm={handleBatchUnassignSelected}
              onCancel={() => setConfirmBatchUnassign(false)}
            />

            <MoveTasksDialog
              isOpen={showMoveDialog}
              taskSets={taskSets}
              numTasks={selectedTasks.size}
              onMove={async (taskSetId) => {
                if (onMoveTasks) await onMoveTasks(Array.from(selectedTasks), taskSetId);
                setSelectedTasks(new Set());
                setShowMoveDialog(false);
              }}
              onCreateSet={async (name) => (onCreateSet ? onCreateSet(name) : null)}
              onCancel={() => setShowMoveDialog(false)}
            />
          </>
        )}
      </FadeIn>
    </div>
  );
};
