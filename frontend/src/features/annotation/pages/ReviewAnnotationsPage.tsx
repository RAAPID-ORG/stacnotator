import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LoadingSpinner } from 'src/shared/ui/LoadingSpinner';

import {
  getAllAnnotationTasks,
  getCampaign,
  exportAnnotations,
  type AnnotationTaskOut,
  type CampaignOut,
} from '~/api/client';
import { useAccountStore } from '~/features/account/account.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { formatTaskStatus, getTaskStatus, getTaskStatusColor } from '~/shared/utils/taskStatus';
import { capitalizeFirst, extractLatLonFromWKT } from '~/shared/utils/utility';
import Statistics from '../components/Statistics';
import { AnnotationDistributionMap } from '../components/AnnotationDistributionMap';

type StatusFilter = 'all' | 'pending' | 'partial' | 'conflicting' | 'complete';
type SortOption = 'default' | 'confidence-asc' | 'confidence-desc' | 'id-asc' | 'id-desc';

export const ViewAnnotationsPage = () => {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const numericCampaignId = Number(campaignId);

  // Data
  const [campaign, setCampaign] = useState<CampaignOut | null>(null);
  const [tasks, setTasks] = useState<AnnotationTaskOut[]>([]);

  // Page States
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showMap, setShowMap] = useState(true);

  // Filter States
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('default');

  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const showAlert = useLayoutStore((state) => state.showAlert);
  const currentUser = useAccountStore((state) => state.account);

  useEffect(() => {
    if (campaign) {
      setBreadcrumbs([
        { label: 'Campaigns', path: '/campaigns' },
        { label: capitalizeFirst(campaign.name), path: `/campaigns/${campaignId}/annotate` },
        { label: 'Review' },
      ]);
    }
  }, [campaign, campaignId, setBreadcrumbs]);

  useEffect(() => {
    if (!campaignId || Number.isNaN(numericCampaignId)) return;

    const loadData = async () => {
      try {
        setLoading(true);

        // Load campaign and tasks in parallel
        // User is already loaded by AuthGate
        const [campaignRes, tasksRes] = await Promise.all([
          getCampaign({ path: { campaign_id: numericCampaignId } }),
          getAllAnnotationTasks({ path: { campaign_id: numericCampaignId } }),
        ]);

        setCampaign(campaignRes.data!);
        setTasks(tasksRes.data!.tasks);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load data';
        showAlert(message, 'error');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [campaignId, numericCampaignId, showAlert]);

  // Filtered tasks based on current filters
  const filteredTasks = useMemo(() => {
    const filtered = tasks.filter((task) => {
      // Status filter
      if (statusFilter !== 'all') {
        const taskStatus = getTaskStatus(task);
        if (taskStatus !== statusFilter) {
          return false;
        }
      }

      // Filter by selected user assignments
      if (selectedUserIds.length > 0) {
        const assignments = task.assignments || [];
        const hasSelectedUser = assignments.some(a => selectedUserIds.includes(a.user_id));
        if (!hasSelectedUser) {
          return false;
        }
      }

      // Search query filter (by annotation number or ID)
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesId = task.id.toString().includes(query);
        const matchesAnnotationNum = task.annotation_number.toString().includes(query);
        if (!matchesId && !matchesAnnotationNum) {
          return false;
        }
      }

      return true;
    });

    // Apply sorting based on selected option
    if (sortOption === 'default') {
      return filtered; // Keep original order
    }

    return [...filtered].sort((a, b) => {
      if (sortOption === 'confidence-asc' || sortOption === 'confidence-desc') {
        // Get minimum confidence from all annotations in each task
        const getMinConfidence = (task: typeof a) => {
          if (!task.annotations || task.annotations.length === 0) return Infinity;
          const confidences = task.annotations
            .map(ann => ann.confidence)
            .filter((c): c is number => c !== null && c !== undefined);
          return confidences.length > 0 ? Math.min(...confidences) : Infinity;
        };

        const minA = getMinConfidence(a);
        const minB = getMinConfidence(b);

        // Tasks with no confidence go to the end
        if (minA === Infinity && minB === Infinity) return 0;
        if (minA === Infinity) return 1;
        if (minB === Infinity) return -1;

        return sortOption === 'confidence-asc' ? minA - minB : minB - minA;
      }

      if (sortOption === 'id-asc') {
        return a.annotation_number - b.annotation_number;
      }

      if (sortOption === 'id-desc') {
        return b.annotation_number - a.annotation_number;
      }

      return 0;
    });
  }, [tasks, statusFilter, selectedUserIds, searchQuery, sortOption]);

  // Get unique users from task assignments
  const uniqueUsers = useMemo(() => {
    const userMap = new Map<string, { id: string; email: string | null; displayName: string | null }>();
    
    tasks.forEach(task => {
      task.assignments?.forEach(assignment => {
        if (!userMap.has(assignment.user_id)) {
          userMap.set(assignment.user_id, {
            id: assignment.user_id,
            email: assignment.user_email || null,
            displayName: assignment.user_display_name || null,
          });
        }
      });
    });

    return Array.from(userMap.values()).sort((a, b) => {
      const nameA = a.displayName || a.email || a.id;
      const nameB = b.displayName || b.email || b.id;
      return nameA.localeCompare(nameB);
    });
  }, [tasks]);

  // Statistics
  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => getTaskStatus(t) === 'complete').length;
    const partial = tasks.filter((t) => getTaskStatus(t) === 'partial').length;
    const conflicting = tasks.filter((t) => getTaskStatus(t) === 'conflicting').length;
    const pending = tasks.filter((t) => getTaskStatus(t) === 'pending').length;
    const assignedToMe = currentUser
      ? tasks.filter((t) => {
          const assignments = t.assignments || [];
          return assignments.some(a => a.user_id === currentUser.id);
        }).length
      : 0;

    return { total, completed, partial, conflicting, pending, assignedToMe };
  }, [tasks, currentUser]);

  const handleNavigateToTask = (taskId: number) => {
    // Navigate to annotation page with this task
    navigate(`/campaigns/${campaignId}/annotate?task=${taskId}&review=true`);
  };

  const handleExportAnnotations = async () => {
    if (!campaign) return;

    try {
      setExporting(true);

      const response = await exportAnnotations({
        path: { campaign_id: numericCampaignId },
        parseAs: 'blob',
      });

      if (!response.response.ok || !response.data) {
        throw new Error('Failed to export annotations');
      }

      const blob = response.data as Blob;
      const contentDisposition = response.response.headers.get('Content-Disposition');
      let filename = `campaign_${campaign.name.replace(/\s+/g, '_')}_annotations.csv`;

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      // Create a download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();

      // Cleanup
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showAlert('Annotations exported successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export annotations';
      showAlert(message, 'error');
      console.error(err);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading annotations..." />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-neutral-700">Campaign not found</p>
      </div>
    );
  }

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
          <button
            onClick={handleExportAnnotations}
            disabled={exporting || tasks.length === 0}
            className="px-4 py-2 bg-white border border-neutral-300 text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {exporting ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Exporting...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Export CSV
              </>
            )}
          </button>
          <button
            onClick={() => navigate(`/campaigns/${campaignId}/annotate`)}
            className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 transition-colors text-sm font-medium"
          >
            Start Annotating
          </button>
        </div>
      </div>

      {/* Map */}
      {showMap && tasks.length > 0 && (
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

      {/* Campaign Statistics */}
      {tasks.length > 0 && (
        <Statistics campaignId={numericCampaignId} />
      )}

      {/* Filters */}
      <div className="bg-white border border-neutral-300 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-neutral-900">Filters & Search</h3>
          {tasks.length > 0 && (
            <button
              onClick={() => setShowMap(!showMap)}
              className="text-sm text-brand-600 hover:text-brand-700 font-medium"
            >
              {showMap ? 'Hide Map' : 'Show Map'}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-neutral-700">Status:</label>
            <div className="flex gap-1">
              {(['all', 'pending', 'partial', 'conflicting', 'complete'] as StatusFilter[]).map((status) => (
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

          {/* Filter by User */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-neutral-700">Filter by User:</label>
            <div className="relative">
              <button
                onClick={() => setShowUserDropdown(!showUserDropdown)}
                className="px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white min-w-[200px] text-left flex items-center justify-between hover:bg-neutral-50"
              >
                <span className="text-neutral-700">
                  {selectedUserIds.length > 0 
                    ? `${selectedUserIds.length} user${selectedUserIds.length > 1 ? 's' : ''} selected` 
                    : 'All users'}
                </span>
                <svg className="w-4 h-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {showUserDropdown && (
                <>
                  {/* Backdrop to close dropdown when clicking outside */}
                  <div 
                    className="fixed inset-0 z-10" 
                    onClick={() => setShowUserDropdown(false)}
                  />
                  
                  {/* Dropdown menu */}
                  <div className="absolute z-20 mt-1 w-64 bg-white border border-neutral-300 rounded-md shadow-lg max-h-80 overflow-y-auto">
                    {/* Clear all button */}
                    {selectedUserIds.length > 0 && (
                      <div className="sticky top-0 bg-neutral-50 border-b border-neutral-200 px-3 py-2">
                        <button
                          onClick={() => setSelectedUserIds([])}
                          className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                        >
                          Clear all
                        </button>
                      </div>
                    )}
                    
                    {/* User checkboxes */}
                    <div className="py-1">
                      {uniqueUsers.map(user => {
                        const displayName = user.displayName || user.email || user.id.substring(0, 8);
                        const isSelected = selectedUserIds.includes(user.id);
                        const isCurrentUser = currentUser?.id === user.id;
                        
                        return (
                          <label
                            key={user.id}
                            className="flex items-center px-3 py-2 hover:bg-neutral-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedUserIds([...selectedUserIds, user.id]);
                                } else {
                                  setSelectedUserIds(selectedUserIds.filter(id => id !== user.id));
                                }
                              }}
                              className="w-4 h-4 text-brand-600 border-neutral-300 rounded focus:ring-brand-500"
                            />
                            <span className="ml-2 text-sm text-neutral-700">
                              {isCurrentUser && <span className="font-medium text-brand-600">(You) </span>}
                              {displayName}
                            </span>
                          </label>
                        );
                      })}
                      
                      {uniqueUsers.length === 0 && (
                        <div className="px-3 py-2 text-sm text-neutral-500">
                          No users assigned to tasks
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

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
                const latLon = extractLatLonFromWKT(task.geometry.geometry);
                const taskStatus = getTaskStatus(task);
                const assignments = task.assignments || [];
                const annotations = task.annotations || [];
                const isAssignedToMe = currentUser && assignments.some(a => a.user_id === currentUser.id);

                return (
                  <tr
                    key={task.id}
                    className={`border-b border-neutral-200 hover:bg-neutral-50 transition-colors ${
                      isAssignedToMe ? 'bg-brand-50/30' : 'bg-white'
                    }`}
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
                      {latLon ? `${latLon.lat.toFixed(5)}, ${latLon.lon.toFixed(5)}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {annotations.length > 0 ? (
                          annotations.map((ann) => {
                            // Find the user who made this annotation
                            const annotator = assignments.find(a => a.user_id === ann.created_by_user_id);
                            const isCurrentUser = ann.created_by_user_id === currentUser?.id;
                            const displayName = isCurrentUser 
                              ? currentUser.display_name || currentUser.email || 'You'
                              : annotator?.user_display_name || annotator?.user_email || ann.created_by_user_id?.substring(0, 8) || 'Unknown';
                            
                            const label = ann.label_id ? `#${ann.label_id}` : '—';
                            const confidence = ann.confidence !== null && ann.confidence !== undefined ? `${ann.confidence}/5` : '—';
                            const hasComment = ann.comment && ann.comment.trim() !== '';
                            
                            return (
                              <div
                                key={ann.id}
                                className="text-xs px-2 py-1 rounded inline-flex items-center gap-1 bg-gray-100 text-gray-700"
                              >
                                <span className="font-medium" title="Annotator">
                                  {displayName}
                                </span>
                                <span className="text-neutral-400">|</span>
                                <span title="Label ID">
                                  {label}
                                </span>
                                <span className="text-neutral-400">|</span>
                                <span 
                                  className={ann.confidence !== null && ann.confidence !== undefined ? 'font-bold' : ''}
                                  title="Confidence rating"
                                >
                                  {confidence}
                                </span>
                                {hasComment && (
                                  <>
                                    <span className="text-neutral-400">|</span>
                                    <span className="relative group cursor-help">
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth={2}
                                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                                        />
                                      </svg>
                                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 pointer-events-none">
                                        <div className="bg-gray-900 text-white text-xs rounded-lg py-2 px-3 max-w-xs shadow-lg">
                                          <div className="font-semibold mb-1">Comment:</div>
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
                        ) : assignments.length > 0 ? (
                          // Show assignments if no annotations yet
                          assignments.map((assignment) => {
                            const isCurrentUser = assignment.user_id === currentUser?.id;
                            const displayName = isCurrentUser 
                              ? currentUser.display_name || currentUser.email || 'You'
                              : assignment.user_display_name || assignment.user_email || assignment.user_id.substring(0, 8);
                            
                            return (
                              <div
                                key={assignment.user_id}
                                className="text-xs px-2 py-1 rounded inline-flex items-center gap-1 bg-gray-100 text-gray-700"
                              >
                                <span className="font-medium" title="Assigned to">
                                  {displayName}
                                </span>
                                <span className="text-neutral-400">|</span>
                                <span title="Label ID">—</span>
                                <span className="text-neutral-400">|</span>
                                <span title="Confidence rating">—</span>
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-xs px-2 py-1 rounded inline-flex items-center gap-1 bg-neutral-100 text-neutral-500">
                            <span>Unassigned</span>
                            <span className="text-neutral-400">|</span>
                            <span>—</span>
                            <span className="text-neutral-400">|</span>
                            <span>—</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleNavigateToTask(task.id)}
                        className="text-brand-500 hover:text-brand-700 text-sm font-medium transition-colors"
                      >
                        {taskStatus === 'pending' ? 'Annotate' : 'View'}
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
              {filteredTasks.filter((t) => getTaskStatus(t) === 'complete').length}
            </strong>
          </span>
          <span>
            Partial:{' '}
            <strong className="text-neutral-900">
              {filteredTasks.filter((t) => getTaskStatus(t) === 'partial').length}
            </strong>
          </span>
          <span>
            Conflicting:{' '}
            <strong className="text-neutral-900">
              {filteredTasks.filter((t) => getTaskStatus(t) === 'conflicting').length}
            </strong>
          </span>
          <span>
            Pending:{' '}
            <strong className="text-neutral-900">
              {filteredTasks.filter((t) => getTaskStatus(t) === 'pending').length}
            </strong>
          </span>
        </div>
      )}
    </div>
  );
};
