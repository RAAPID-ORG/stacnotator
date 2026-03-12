import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import {
  getAllAnnotationsForCampaign,
  getCampaignUsers,
  type AnnotationOut,
  type CampaignOut,
  type CampaignUserOut,
} from '~/api/client';
import { useAccountStore } from '~/features/account/account.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { capitalizeFirst, extractCentroidFromWKT } from '~/shared/utils/utility';
import { OpenModeDistributionMap } from '~/features/annotation/components/OpenModeDistributionMap';
import { ExportDropdown } from './ExportDropdown';
import { UserFilterDropdown } from './UserFilterDropdown';
import type { SortOption, UserInfo } from './types';

interface OpenModeReviewProps {
  campaign: CampaignOut;
  campaignId: number;
}

export const OpenModeReview = ({ campaign, campaignId }: OpenModeReviewProps) => {
  const navigate = useNavigate();
  const currentUser = useAccountStore((state) => state.account);
  const showAlert = useLayoutStore((state) => state.showAlert);

  const [annotations, setAnnotations] = useState<AnnotationOut[]>([]);
  const [campaignUsers, setCampaignUsers] = useState<CampaignUserOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlightedAnnotationId, setHighlightedAnnotationId] = useState<number | null>(null);

  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('default');

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const annotationsRes = await getAllAnnotationsForCampaign({
          path: { campaign_id: campaignId },
        });
        setAnnotations(annotationsRes.data || []);

        try {
          const usersRes = await getCampaignUsers({ path: { campaign_id: campaignId } });
          setCampaignUsers(usersRes.data?.users || []);
        } catch {
          // Non-admin: user list will be derived from annotations
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load annotations';
        showAlert(message, 'error');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [campaignId, showAlert]);

  const uniqueUsers = useMemo((): UserInfo[] => {
    if (campaignUsers.length > 0) {
      return campaignUsers
        .map((cu) => ({
          id: cu.user.id,
          email: cu.user.email,
          displayName: cu.user.display_name,
        }))
        .sort((a, b) =>
          (a.displayName || a.email || a.id).localeCompare(b.displayName || b.email || b.id)
        );
    }
    const m = new Map<string, UserInfo>();
    annotations.forEach((ann) => {
      if (!m.has(ann.created_by_user_id)) {
        m.set(ann.created_by_user_id, { id: ann.created_by_user_id, email: null, displayName: null });
      }
    });
    return Array.from(m.values());
  }, [campaignUsers, annotations]);

  const labels = campaign.settings.labels;

  const filteredAnnotations = useMemo(() => {
    const filtered = annotations.filter((ann) => {
      if (selectedUserIds.length > 0 && !selectedUserIds.includes(ann.created_by_user_id)) return false;
      if (selectedLabelIds.length > 0 && (ann.label_id === null || !selectedLabelIds.includes(ann.label_id))) return false;
      if (searchQuery && !ann.id.toString().includes(searchQuery.toLowerCase())) return false;
      return true;
    });

    if (sortOption === 'default') return filtered;
    return [...filtered].sort((a, b) => {
      if (sortOption === 'confidence-asc' || sortOption === 'confidence-desc') {
        const ca = a.confidence ?? Infinity, cb = b.confidence ?? Infinity;
        if (ca === Infinity && cb === Infinity) return 0;
        if (ca === Infinity) return 1;
        if (cb === Infinity) return -1;
        return sortOption === 'confidence-asc' ? ca - cb : cb - ca;
      }
      if (sortOption === 'id-asc') return a.id - b.id;
      if (sortOption === 'id-desc') return b.id - a.id;
      return 0;
    });
  }, [annotations, selectedUserIds, selectedLabelIds, searchQuery, sortOption]);

  const stats = useMemo(() => {
    let withConfidence = 0;
    annotations.forEach((ann) => {
      if (ann.confidence != null) withConfidence++;
    });
    return { total: annotations.length, withConfidence };
  }, [annotations]);

  const handleNavigateToAnnotation = (ann: AnnotationOut) => {
    const centroid = extractCentroidFromWKT(ann.geometry.geometry);
    if (centroid) {
      navigate(`/campaigns/${campaignId}/annotate?lat=${centroid.lat}&lon=${centroid.lon}&annotation=${ann.id}&review=true`);
    } else {
      navigate(`/campaigns/${campaignId}/annotate?review=true`);
    }
  };

  const getUserDisplayName = (userId: string): string => {
    if (userId === currentUser?.id) return currentUser.display_name || currentUser.email || 'You';
    const cu = campaignUsers.find((u) => u.user.id === userId);
    if (cu) return cu.user.display_name || cu.user.email;
    return userId.substring(0, 8);
  };

  const getLabelName = (labelId: number | null): string => {
    if (labelId === null) return 'No label';
    const label = labels.find((l) => l.id === labelId);
    return label?.name || `Label #${labelId}`;
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading annotations..." />
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
            {annotations.length} annotation{annotations.length !== 1 ? 's' : ''} in open-mode campaign
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportDropdown campaignId={campaignId} campaign={campaign} disabled={annotations.length === 0} />
          <button
            onClick={() => navigate(`/campaigns/${campaignId}/annotate`)}
            className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 transition-colors text-sm font-medium"
          >
            Start Annotating
          </button>
        </div>
      </div>

      {/* Map */}
      {annotations.length > 0 && (
        <div className="bg-white rounded-lg border border-neutral-300 p-4 mb-6">
          <h2 className="text-lg font-semibold text-neutral-900 mb-3">
            Annotation Locations ({filteredAnnotations.length})
          </h2>
          <OpenModeDistributionMap
            annotations={filteredAnnotations}
            labels={labels}
            bbox={{
              west: campaign.settings.bbox_west,
              south: campaign.settings.bbox_south,
              east: campaign.settings.bbox_east,
              north: campaign.settings.bbox_north,
            }}
            highlightedAnnotationId={highlightedAnnotationId}
            onAnnotationClick={handleNavigateToAnnotation}
          />
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-neutral-300 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-neutral-900">Filters & Search</h3>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {/* Label Filter */}
          {labels.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-neutral-700">Label:</label>
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => setSelectedLabelIds([])}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    selectedLabelIds.length === 0
                      ? 'bg-brand-500 text-white'
                      : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                  }`}
                >
                  All
                </button>
                {labels.map((label) => (
                  <button
                    key={label.id}
                    onClick={() =>
                      setSelectedLabelIds(
                        selectedLabelIds.includes(label.id)
                          ? selectedLabelIds.filter((id) => id !== label.id)
                          : [...selectedLabelIds, label.id]
                      )
                    }
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                      selectedLabelIds.includes(label.id)
                        ? 'bg-brand-500 text-white'
                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                    }`}
                  >
                    {label.name}
                  </button>
                ))}
              </div>
            </div>
          )}

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
              <option value="confidence-asc">Confidence (Low → High)</option>
              <option value="confidence-desc">Confidence (High → Low)</option>
              <option value="id-asc">ID (Ascending)</option>
              <option value="id-desc">ID (Descending)</option>
            </select>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 ml-auto">
            <input
              type="text"
              placeholder="Search by annotation ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 w-64"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-neutral-500 hover:text-neutral-700">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-neutral-200 text-sm text-neutral-600">
          Showing {filteredAnnotations.length} of {annotations.length} annotations
        </div>
      </div>

      {/* Annotations Table */}
      {filteredAnnotations.length === 0 ? (
        <div className="text-center py-12 bg-white border border-neutral-300 rounded-lg">
          <svg className="w-12 h-12 text-neutral-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-neutral-700 mb-2">
            {annotations.length === 0 ? 'No annotations yet' : 'No annotations match your filters'}
          </p>
          <p className="text-neutral-500 text-sm">
            {annotations.length === 0 ? 'Start annotating to see entries here' : 'Try adjusting your filter criteria'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-neutral-300 rounded-lg bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-300">
                <th className="px-4 py-3 text-left font-medium text-neutral-700">ID</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Label</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Annotator</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Confidence</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Coordinates</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Created</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Comment</th>
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAnnotations.map((ann) => {
                const centroid = extractCentroidFromWKT(ann.geometry.geometry);
                const isMine = ann.created_by_user_id === currentUser?.id;
                const createdAt = new Date(ann.created_at);

                return (
                  <tr
                    key={ann.id}
                    className={`border-b border-neutral-200 hover:bg-neutral-50 transition-colors ${isMine ? 'bg-brand-50/30' : 'bg-white'} ${highlightedAnnotationId === ann.id ? 'ring-2 ring-brand-400 ring-inset' : ''}`}
                    onMouseEnter={() => setHighlightedAnnotationId(ann.id)}
                    onMouseLeave={() => setHighlightedAnnotationId(null)}
                  >
                    <td className="px-4 py-3 text-neutral-900 font-medium font-mono text-xs">{ann.id}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">
                        {getLabelName(ann.label_id)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-700 text-sm">
                      {isMine && <span className="text-brand-600 font-medium">(You) </span>}
                      {getUserDisplayName(ann.created_by_user_id)}
                    </td>
                    <td className="px-4 py-3">
                      {ann.confidence != null ? (
                        <span className="font-bold text-neutral-900">{ann.confidence}/5</span>
                      ) : (
                        <span className="text-neutral-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-900 text-xs font-mono">
                      {centroid ? `${centroid.lat.toFixed(5)}, ${centroid.lon.toFixed(5)}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-neutral-600 text-xs">
                      {createdAt.toLocaleDateString()} {createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3">
                      {ann.comment?.trim() ? (
                        <span className="relative group cursor-help">
                          <svg className="w-4 h-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 pointer-events-none">
                            <div className="bg-gray-900 text-white text-xs rounded-lg py-2 px-3 max-w-xs shadow-lg">
                              <div className="whitespace-pre-wrap">{ann.comment}</div>
                              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                            </div>
                          </div>
                        </span>
                      ) : (
                        <span className="text-neutral-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleNavigateToAnnotation(ann)}
                        className="text-brand-500 hover:text-brand-700 text-sm font-medium transition-colors"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      {filteredAnnotations.length > 0 && (
        <div className="mt-4 flex items-center gap-6 text-sm text-neutral-600">
          <span>Showing: <strong className="text-neutral-900">{filteredAnnotations.length}</strong></span>
          <span>Total: <strong className="text-neutral-900">{annotations.length}</strong></span>
          {stats.withConfidence > 0 && (
            <span>With Confidence: <strong className="text-neutral-900">{stats.withConfidence}</strong></span>
          )}
        </div>
      )}
    </div>
  );
};
