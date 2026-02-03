import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LoadingSpinner } from '~/components/shared/LoadingSpinner';
import { AnnotationDistributionMap } from '~/components/campaign/view-annotations/AnnotationDistributionMap';
import { useUIStore } from '~/stores/uiStore';
import { useUserStore } from '~/stores/userStore';
import { capitalizeFirst, extractLatLonFromWKT } from '~/utils/utility';
import {
  getAllAnnotationTasks,
  getCampaign,
  exportAnnotations,
  type AnnotationTaskItemOut,
  type CampaignOut,
} from '~/api/client';

type StatusFilter = 'all' | 'pending' | 'done' | 'skipped';

export const ViewAnnotationsPage = () => {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const numericCampaignId = Number(campaignId);

  // Data
  const [campaign, setCampaign] = useState<CampaignOut | null>(null);
  const [tasks, setTasks] = useState<AnnotationTaskItemOut[]>([]);

  // Page States
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showMap, setShowMap] = useState(true);

  // Filter States
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showOnlyAssigned, setShowOnlyAssigned] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const setBreadcrumbs = useUIStore((state) => state.setBreadcrumbs);
  const showAlert = useUIStore((state) => state.showAlert);
  const currentUser = useUserStore((state) => state.currentUser);

  useEffect(() => {
    if (campaign) {
      setBreadcrumbs([
        { label: 'Campaigns', path: '/campaigns' },
        { label: capitalizeFirst(campaign.name), path: `/campaigns/${campaignId}/annotate` },
        { label: 'View Annotations' },
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
    return tasks.filter((task) => {
      // Status filter
      if (statusFilter !== 'all' && task.status !== statusFilter) {
        return false;
      }

      // Assigned to me filter
      if (showOnlyAssigned && currentUser) {
        if (!task.assigned_user || task.assigned_user.id !== currentUser.id) {
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
  }, [tasks, statusFilter, showOnlyAssigned, currentUser, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === 'done').length;
    const skipped = tasks.filter((t) => t.status === 'skipped').length;
    const pending = tasks.filter((t) => t.status === 'pending').length;
    const assignedToMe = currentUser
      ? tasks.filter((t) => t.assigned_user?.id === currentUser.id).length
      : 0;

    return { total, completed, skipped, pending, assignedToMe };
  }, [tasks, currentUser]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'done':
        return 'bg-green-100 text-green-800';
      case 'skipped':
        return 'bg-yellow-100 text-yellow-800';
      case 'pending':
      default:
        return 'bg-neutral-300 text-neutral-800';
    }
  };

  const handleNavigateToTask = (taskId: number) => {
    // Navigate to annotation page with this task
    navigate(`/campaigns/${campaignId}/annotate?task=${taskId}`);
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
              {(['all', 'pending', 'done', 'skipped'] as StatusFilter[]).map((status) => (
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

          {/* Assigned to Me Toggle */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-neutral-700">
              <input
                type="checkbox"
                checked={showOnlyAssigned}
                onChange={(e) => setShowOnlyAssigned(e.target.checked)}
                className="w-4 h-4 text-brand-600 rounded focus:ring-brand-500 mr-2"
              />
              Show only assigned to me
            </label>
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
              Completed: <strong className="text-neutral-900">{stats.completed}</strong>
            </span>
            <span>
              Skipped: <strong className="text-neutral-900">{stats.skipped}</strong>
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
                <th className="px-4 py-3 text-left font-medium text-neutral-700">ID</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Annotation #</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Status</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Coordinates</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Assigned To</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Label</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => {
                const latLon = extractLatLonFromWKT(task.geometry.geometry);
                const isAssignedToMe = currentUser && task.assigned_user?.id === currentUser.id;

                return (
                  <tr
                    key={task.id}
                    className={`border-b border-neutral-200 hover:bg-neutral-50 transition-colors ${
                      isAssignedToMe ? 'bg-brand-50/30' : 'bg-white'
                    }`}
                  >
                    <td className="px-4 py-3 text-neutral-500">{task.id}</td>
                    <td className="px-4 py-3 text-neutral-900 font-medium">
                      {task.annotation_number}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-1 rounded text-xs font-medium capitalize ${getStatusColor(task.status)}`}
                      >
                        {task.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-900 text-xs font-mono">
                      {latLon ? `${latLon.lat.toFixed(5)}, ${latLon.lon.toFixed(5)}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {task.assigned_user ? (
                        <span
                          className={`text-sm ${
                            isAssignedToMe ? 'text-brand-600 font-medium' : 'text-neutral-700'
                          }`}
                        >
                          {isAssignedToMe ? 'You' : task.assigned_user.display_name}
                        </span>
                      ) : (
                        <span className="text-neutral-400 text-sm">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {task.annotation ? (
                        <span className="text-sm text-neutral-700">
                          #{task.annotation.label_id}
                          {task.annotation.comment && (
                            <span className="text-neutral-400 ml-1" title={task.annotation.comment}>
                              💬
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-neutral-400 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        disabled={true}
                        onClick={() => handleNavigateToTask(task.id)}
                        className="text-brand-500 hover:text-brand-700 text-sm font-medium transition-colors"
                      >
                        {task.status === 'pending' ? 'Annotate' : 'View'}
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
            Completed:{' '}
            <strong className="text-neutral-900">
              {filteredTasks.filter((t) => t.status === 'done').length}
            </strong>
          </span>
          <span>
            Skipped:{' '}
            <strong className="text-neutral-900">
              {filteredTasks.filter((t) => t.status === 'skipped').length}
            </strong>
          </span>
          <span>
            Pending:{' '}
            <strong className="text-neutral-900">
              {filteredTasks.filter((t) => t.status === 'pending').length}
            </strong>
          </span>
        </div>
      )}
    </div>
  );
};
