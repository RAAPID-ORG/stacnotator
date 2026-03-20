import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { getAllAnnotationTasks, type AnnotationTaskOut, type CampaignOut } from '~/api/client';
import { useAccountStore } from '~/features/account/account.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { formatTaskStatus, getTaskStatusColor } from '~/shared/utils/taskStatus';
import type { TaskStatus } from '~/shared/utils/taskStatus';
import { extractCentroidFromWKT } from '~/shared/utils/utility';
import Statistics from '~/features/annotation/components/Statistics';
import { AnnotationDistributionMap } from '~/features/annotation/components/AnnotationDistributionMap';
import { ExportDropdown } from './ExportDropdown';
import { UserFilterDropdown } from './UserFilterDropdown';
import type { SortOption, StatusFilter, UserInfo } from './types';

interface TaskModeReviewProps {
  campaign: CampaignOut;
  campaignId: number;
}

export const TaskModeReview = ({ campaign, campaignId }: TaskModeReviewProps) => {
  const navigate = useNavigate();
  const currentUser = useAccountStore((state) => state.account);
  const showAlert = useLayoutStore((state) => state.showAlert);

  const [tasks, setTasks] = useState<AnnotationTaskOut[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('default');

  useEffect(() => {
    const loadTasks = async () => {
      try {
        setLoading(true);
        const tasksRes = await getAllAnnotationTasks({ path: { campaign_id: campaignId } });
        setTasks(tasksRes.data!.tasks);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load tasks';
        showAlert(message, 'error');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadTasks();
  }, [campaignId, showAlert]);

  const filteredTasks = useMemo(() => {
    const filtered = tasks.filter((task) => {
      if (statusFilter !== 'all' && task.task_status !== statusFilter) return false;
      if (selectedUserIds.length > 0) {
        const assignments = task.assignments || [];
        if (!assignments.some((a) => selectedUserIds.includes(a.user_id))) return false;
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
  }, [tasks, statusFilter, selectedUserIds, searchQuery, sortOption]);

  const uniqueUsers = useMemo(() => {
    const m = new Map<string, UserInfo>();
    tasks.forEach((t) =>
      t.assignments?.forEach((a) => {
        if (!m.has(a.user_id))
          m.set(a.user_id, {
            id: a.user_id,
            email: a.user_email || null,
            displayName: a.user_display_name || null,
          });
      })
    );
    return Array.from(m.values()).sort((a, b) =>
      (a.displayName || a.email || a.id).localeCompare(b.displayName || b.email || b.id)
    );
  }, [tasks]);

  const stats = useMemo(
    () => ({
      total: tasks.length,
      completed: tasks.filter((t) => t.task_status === 'done').length,
      partial: tasks.filter((t) => t.task_status === 'partial').length,
      conflicting: tasks.filter((t) => t.task_status === 'conflicting').length,
      pending: tasks.filter((t) => t.task_status === 'pending').length,
      skipped: tasks.filter((t) => t.task_status === 'skipped').length,
    }),
    [tasks]
  );

  const handleNavigateToTask = (taskId: number) => {
    navigate(`/campaigns/${campaignId}/annotate?task=${taskId}&review=true`);
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
    <div className="flex-1 p-8 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">
            {capitalizeFirst(campaign.name)} - Annotations
          </h1>
          <p className="text-sm text-neutral-600 mt-1">
            View and filter all annotation tasks for this campaign
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportDropdown
            campaignId={campaignId}
            campaign={campaign}
            disabled={tasks.length === 0}
          />
          <button
            onClick={() => navigate(`/campaigns/${campaignId}/annotate`)}
            className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 transition-colors text-sm font-medium"
          >
            Start Annotating
          </button>
        </div>
      </div>

      {/* Map */}
      {tasks.length > 0 && (
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
      {tasks.length > 0 && <Statistics campaignId={campaignId} />}

      {/* Filters */}
      <div className="bg-white border border-neutral-300 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-neutral-900">Filters & Search</h3>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-neutral-700">Status:</label>
            <div className="flex gap-1">
              {(
                ['all', 'pending', 'partial', 'conflicting', 'done', 'skipped'] as StatusFilter[]
              ).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    statusFilter === status
                      ? 'bg-brand-500 text-white'
                      : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                  }`}
                >
                  {status === 'all' ? 'All' : capitalizeFirst(status)}
                </button>
              ))}
            </div>
          </div>

          {/* User Filter */}
          <UserFilterDropdown
            users={uniqueUsers}
            selectedUserIds={selectedUserIds}
            setSelectedUserIds={setSelectedUserIds}
            currentUserId={currentUser?.id}
          />

          {/* Sort By */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-neutral-700">Sort by:</label>
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
              className="px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            >
              <option value="default">Default</option>
              <option value="confidence-asc">Confidence (Low to High)</option>
              <option value="confidence-desc">Confidence (High to Low)</option>
              <option value="id-asc">Annotation # (Ascending)</option>
              <option value="id-desc">Annotation # (Descending)</option>
            </select>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 ml-auto">
            <input
              type="text"
              placeholder="Search by ID or annotation #..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 w-64"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-neutral-500 hover:text-neutral-700"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

        {/* Filter Results Summary */}
        <div className="mt-3 pt-3 border-t border-neutral-200 flex items-center justify-between text-sm text-neutral-600">
          <span>
            Showing {filteredTasks.length} of {tasks.length} tasks
          </span>
          <div className="flex items-center gap-4">
            <span>
              Complete: <strong className="text-neutral-900">{stats.completed}</strong>
            </span>
            <span>
              Partial: <strong className="text-neutral-900">{stats.partial}</strong>
            </span>
            <span>
              Conflicting: <strong className="text-neutral-900">{stats.conflicting}</strong>
            </span>
            <span>
              Pending: <strong className="text-neutral-900">{stats.pending}</strong>
            </span>
            <span>
              Skipped: <strong className="text-neutral-900">{stats.skipped}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Tasks Table */}
      {filteredTasks.length === 0 ? (
        <div className="text-center py-12 bg-white border border-neutral-300 rounded-lg">
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
        <div className="overflow-x-auto border border-neutral-300 rounded-lg bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-300">
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Annotation #</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Status</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Coordinates</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Annotations</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => {
                const latLon = extractCentroidFromWKT(task.geometry.geometry);
                const taskStatus = task.task_status as TaskStatus;
                const assignments = task.assignments || [];
                const annotations = task.annotations || [];
                const isAssignedToMe =
                  currentUser && assignments.some((a) => a.user_id === currentUser.id);

                return (
                  <tr
                    key={task.id}
                    className={`border-b border-neutral-200 hover:bg-neutral-50 transition-colors ${isAssignedToMe ? 'bg-brand-50/30' : 'bg-white'}`}
                  >
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
                              : annotator?.user_display_name ||
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
                            const confidence = ann.confidence != null ? `${ann.confidence}/5` : '-';
                            const hasComment = ann.comment && ann.comment.trim() !== '';

                            return (
                              <div
                                key={ann.id}
                                className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${isSkippedAnn ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-700'}`}
                              >
                                <span className="font-medium" title="Annotator">
                                  {displayName}
                                </span>
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
                                    <span className="relative group cursor-help">
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
                                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 pointer-events-none">
                                        <div className="bg-gray-900 text-white text-xs rounded-lg py-2 px-3 max-w-xs shadow-lg">
                                          <div className="whitespace-pre-wrap">{ann.comment}</div>
                                          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                                        </div>
                                      </div>
                                    </span>
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
                              : a.user_display_name || a.user_email || a.user_id.substring(0, 8);
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
                        className="text-brand-500 hover:text-brand-700 text-sm font-medium transition-colors"
                      >
                        {taskStatus === 'pending' || taskStatus === 'skipped' ? 'Annotate' : 'View'}
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
      {filteredTasks.length > 0 && (
        <div className="mt-4 flex items-center gap-6 text-sm text-neutral-600">
          <span>
            Filtered: <strong className="text-neutral-900">{filteredTasks.length}</strong>
          </span>
          <span>
            Complete:{' '}
            <strong className="text-neutral-900">
              {filteredTasks.filter((t) => t.task_status === 'done').length}
            </strong>
          </span>
          <span>
            Partial:{' '}
            <strong className="text-neutral-900">
              {filteredTasks.filter((t) => t.task_status === 'partial').length}
            </strong>
          </span>
          <span>
            Conflicting:{' '}
            <strong className="text-neutral-900">
              {filteredTasks.filter((t) => t.task_status === 'conflicting').length}
            </strong>
          </span>
          <span>
            Pending:{' '}
            <strong className="text-neutral-900">
              {filteredTasks.filter((t) => t.task_status === 'pending').length}
            </strong>
          </span>
          <span>
            Skipped:{' '}
            <strong className="text-neutral-900">
              {filteredTasks.filter((t) => t.task_status === 'skipped').length}
            </strong>
          </span>
        </div>
      )}
    </div>
  );
};
