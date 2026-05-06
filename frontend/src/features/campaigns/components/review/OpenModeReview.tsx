import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import {
  batchDeleteAnnotations,
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
import { Button } from '~/shared/ui/forms';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { UserFilterDropdown } from './UserFilterDropdown';
import { IconFlag } from '~/shared/ui/Icons';
import type { SortOption, UserInfo } from './types';
import { FadeIn } from '~/shared/ui/motion';

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
  const [selectedConfidences, setSelectedConfidences] = useState<number[]>([]);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('default');

  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<Set<number>>(new Set());
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

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
        m.set(ann.created_by_user_id, {
          id: ann.created_by_user_id,
          email: null,
          displayName: null,
        });
      }
    });
    return Array.from(m.values());
  }, [campaignUsers, annotations]);

  const labels = campaign.settings.labels;

  const filteredAnnotations = useMemo(() => {
    const filtered = annotations.filter((ann) => {
      if (selectedUserIds.length > 0 && !selectedUserIds.includes(ann.created_by_user_id))
        return false;
      if (
        selectedLabelIds.length > 0 &&
        (ann.label_id === null || !selectedLabelIds.includes(ann.label_id))
      )
        return false;
      if (selectedConfidences.length > 0) {
        const c = ann.confidence ?? 0;
        if (!selectedConfidences.includes(c)) return false;
      }
      if (flaggedOnly && !ann.flagged_for_review) return false;
      if (searchQuery && !ann.id.toString().includes(searchQuery.toLowerCase())) return false;
      return true;
    });

    if (sortOption === 'default') return filtered;
    return [...filtered].sort((a, b) => {
      if (sortOption === 'confidence-asc' || sortOption === 'confidence-desc') {
        const ca = a.confidence ?? Infinity,
          cb = b.confidence ?? Infinity;
        if (ca === Infinity && cb === Infinity) return 0;
        if (ca === Infinity) return 1;
        if (cb === Infinity) return -1;
        return sortOption === 'confidence-asc' ? ca - cb : cb - ca;
      }
      if (sortOption === 'id-asc') return a.id - b.id;
      if (sortOption === 'id-desc') return b.id - a.id;
      return 0;
    });
  }, [
    annotations,
    selectedUserIds,
    selectedLabelIds,
    selectedConfidences,
    flaggedOnly,
    searchQuery,
    sortOption,
  ]);

  const stats = useMemo(() => {
    let withConfidence = 0;
    annotations.forEach((ann) => {
      if (ann.confidence != null) withConfidence++;
    });
    return { total: annotations.length, withConfidence };
  }, [annotations]);

  const isCampaignAdmin = useMemo(
    () => !!campaignUsers.find((cu) => cu.user.id === currentUser?.id && cu.is_admin),
    [campaignUsers, currentUser?.id]
  );

  // Mirror backend rule (annotation/service.py:delete_annotations_bulk):
  // public campaigns require ownership unless admin; private campaigns let any
  // member with access delete anything.
  const canDeleteAnnotation = (ann: AnnotationOut): boolean => {
    if (!campaign.is_public) return true;
    return isCampaignAdmin || ann.created_by_user_id === currentUser?.id;
  };

  const deletableFilteredIds = useMemo(
    () => filteredAnnotations.filter(canDeleteAnnotation).map((a) => a.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredAnnotations, isCampaignAdmin, currentUser?.id, campaign.is_public]
  );

  // Drop selections that are no longer visible after filter/search changes.
  useEffect(() => {
    setSelectedAnnotationIds((prev) => {
      const visible = new Set(filteredAnnotations.map((a) => a.id));
      let changed = false;
      const next = new Set<number>();
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [filteredAnnotations]);

  const toggleAnnotationSelected = (id: number) => {
    setSelectedAnnotationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allDeletableSelected =
    deletableFilteredIds.length > 0 &&
    deletableFilteredIds.every((id) => selectedAnnotationIds.has(id));

  const toggleSelectAllDeletable = () => {
    setSelectedAnnotationIds((prev) => {
      if (allDeletableSelected) {
        const next = new Set(prev);
        deletableFilteredIds.forEach((id) => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      deletableFilteredIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleBatchDelete = async () => {
    if (selectedAnnotationIds.size === 0) return;
    const ids = Array.from(selectedAnnotationIds);
    try {
      setIsBatchDeleting(true);
      const { data, error } = await batchDeleteAnnotations({
        path: { campaign_id: campaignId },
        body: { annotation_ids: ids },
      });
      if (error || !data) {
        throw new Error(
          (error as { detail?: string } | undefined)?.detail ?? 'Failed to delete annotations'
        );
      }
      const idSet = new Set(ids);
      setAnnotations((prev) => prev.filter((a) => !idSet.has(a.id)));
      setSelectedAnnotationIds(new Set());
      setConfirmBatchDelete(false);
      showAlert(`Deleted ${data.deleted_count} annotation(s)`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete annotations';
      showAlert(message, 'error');
      console.error(err);
    } finally {
      setIsBatchDeleting(false);
    }
  };

  const handleNavigateToAnnotation = (ann: AnnotationOut) => {
    const centroid = extractCentroidFromWKT(ann.geometry.geometry);
    if (centroid) {
      navigate(
        `/campaigns/${campaignId}/annotate?lat=${centroid.lat}&lon=${centroid.lon}&annotation=${ann.id}&review=true`
      );
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
    <div className="flex-1 overflow-auto">
      <FadeIn className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">{capitalizeFirst(campaign.name)} - Annotations</h1>
            <p className="page-subtitle">
              {annotations.length} annotation{annotations.length !== 1 ? 's' : ''} in open-mode
              campaign.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ExportDropdown
              campaignId={campaignId}
              campaign={campaign}
              disabled={annotations.length === 0}
              showMergeToggle={false}
            />
            <Button onClick={() => navigate(`/campaigns/${campaignId}/annotate`)}>
              Start annotating
            </Button>
          </div>
        </header>

        {/* Map */}
        {annotations.length > 0 && (
          <div className="surface mb-6">
            <div className="px-5 py-4 border-b border-neutral-100">
              <h2 className="section-heading">
                Annotation locations{' '}
                <span className="text-neutral-400 font-normal">({filteredAnnotations.length})</span>
              </h2>
            </div>
            <div className="p-4">
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
          </div>
        )}

        {/* Filters */}
        <div className="surface mb-6">
          <div className="px-5 py-4 space-y-3">
            <h3 className="section-heading">Filters & search</h3>
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
                          ? 'bg-brand-600 text-white'
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
                            ? 'bg-brand-600 text-white'
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

              {/* Confidence Filter */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-neutral-700">Confidence:</label>
                <div className="flex gap-1">
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
                    title="Annotations without a confidence rating"
                  >
                    No rating
                  </button>
                </div>
              </div>

              {/* Flagged Filter */}
              <button
                onClick={() => setFlaggedOnly((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors border ${
                  flaggedOnly
                    ? 'bg-rose-100 text-rose-800 border-rose-300'
                    : 'bg-neutral-100 text-neutral-700 border-transparent hover:bg-neutral-200'
                }`}
                title="Show only flagged annotations"
              >
                <IconFlag className="w-3.5 h-3.5" />
                <span>Flagged only</span>
              </button>

              {/* Sort By */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-neutral-700">Sort by:</label>
                <select
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value as SortOption)}
                  className="px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                >
                  <option value="default">Default</option>
                  <option value="confidence-asc">Confidence (Low to High)</option>
                  <option value="confidence-desc">Confidence (High to Low)</option>
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
                  className="px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-600 w-64"
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

            <div className="pt-3 border-t border-neutral-100 text-xs text-neutral-500">
              Showing {filteredAnnotations.length} of {annotations.length} annotations
            </div>
          </div>
        </div>

        {/* Annotations Table */}
        {filteredAnnotations.length === 0 ? (
          <div className="text-center py-12 bg-white border border-neutral-200 rounded-xl shadow-sm">
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
            <p className="text-neutral-700 mb-2">
              {annotations.length === 0
                ? 'No annotations yet'
                : 'No annotations match your filters'}
            </p>
            <p className="text-neutral-500 text-sm">
              {annotations.length === 0
                ? 'Start annotating to see entries here'
                : 'Try adjusting your filter criteria'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-neutral-200 rounded-xl shadow-sm bg-white">
            {/* Batch actions toolbar - shown only when there are selectable rows */}
            {deletableFilteredIds.length > 0 && (
              <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-neutral-200 bg-neutral-50">
                <span className="text-xs text-neutral-600">
                  {selectedAnnotationIds.size > 0
                    ? `${selectedAnnotationIds.size} selected`
                    : `Select annotations to delete (${deletableFilteredIds.length} available)`}
                </span>
                <Button
                  variant="danger"
                  onClick={() => setConfirmBatchDelete(true)}
                  disabled={selectedAnnotationIds.size === 0 || isBatchDeleting}
                >
                  {isBatchDeleting ? 'Deleting…' : 'Delete selected'}
                </Button>
              </div>
            )}
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200">
                  <th className="px-3 py-3 text-left">
                    <input
                      type="checkbox"
                      aria-label="Select all deletable annotations"
                      checked={allDeletableSelected}
                      onChange={toggleSelectAllDeletable}
                      disabled={deletableFilteredIds.length === 0}
                      className="w-4 h-4 rounded border-neutral-300 text-brand-700 focus:ring-brand-600 cursor-pointer disabled:cursor-not-allowed"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">
                    ID
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">
                    Label
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">
                    Annotator
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">
                    Confidence
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">
                    Coordinates
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">
                    Comment
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">
                    Flag
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAnnotations.map((ann) => {
                  const centroid = extractCentroidFromWKT(ann.geometry.geometry);
                  const isMine = ann.created_by_user_id === currentUser?.id;
                  const createdAt = new Date(ann.created_at);
                  const canDelete = canDeleteAnnotation(ann);
                  const isSelected = selectedAnnotationIds.has(ann.id);

                  return (
                    <tr
                      key={ann.id}
                      className={`border-b border-neutral-200 hover:bg-neutral-50 transition-colors ${isMine ? 'bg-brand-50/30' : 'bg-white'} ${highlightedAnnotationId === ann.id ? 'ring-2 ring-brand-400 ring-inset' : ''}`}
                      onMouseEnter={() => setHighlightedAnnotationId(ann.id)}
                      onMouseLeave={() => setHighlightedAnnotationId(null)}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select annotation ${ann.id}`}
                          checked={isSelected}
                          onChange={() => toggleAnnotationSelected(ann.id)}
                          disabled={!canDelete}
                          title={
                            !canDelete
                              ? 'You can only delete your own annotations in this campaign'
                              : undefined
                          }
                          className="w-4 h-4 rounded border-neutral-300 text-brand-700 focus:ring-brand-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </td>
                      <td className="px-4 py-3 text-neutral-900 font-medium font-mono text-xs">
                        {ann.id}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block px-2 py-1 rounded text-xs font-medium bg-neutral-100 text-neutral-700">
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
                        {createdAt.toLocaleDateString()}{' '}
                        {createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3">
                        {ann.comment?.trim() ? (
                          <span className="relative group cursor-help">
                            <svg
                              className="w-4 h-4 text-neutral-500"
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
                              <div className="bg-neutral-900 text-white text-xs rounded-lg py-2 px-3 max-w-xs shadow-lg">
                                <div className="whitespace-pre-wrap">{ann.comment}</div>
                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-neutral-900"></div>
                              </div>
                            </div>
                          </span>
                        ) : (
                          <span className="text-neutral-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {ann.flagged_for_review ? (
                          <span
                            className="relative group cursor-help inline-flex items-center text-rose-600"
                            title={ann.flag_comment || 'Flagged for review'}
                          >
                            <IconFlag className="w-4 h-4" />
                            {ann.flag_comment?.trim() && (
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 pointer-events-none">
                                <div className="bg-rose-900 text-white text-xs rounded-lg py-2 px-3 max-w-xs shadow-lg">
                                  <div className="whitespace-pre-wrap">{ann.flag_comment}</div>
                                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-rose-900"></div>
                                </div>
                              </div>
                            )}
                          </span>
                        ) : (
                          <span className="text-neutral-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleNavigateToAnnotation(ann)}
                          className="text-brand-700 hover:text-brand-900 text-sm font-medium transition-colors"
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
            <span>
              Showing: <strong className="text-neutral-900">{filteredAnnotations.length}</strong>
            </span>
            <span>
              Total: <strong className="text-neutral-900">{annotations.length}</strong>
            </span>
            {stats.withConfidence > 0 && (
              <span>
                With Confidence:{' '}
                <strong className="text-neutral-900">{stats.withConfidence}</strong>
              </span>
            )}
          </div>
        )}
      </FadeIn>

      <ConfirmDialog
        isOpen={confirmBatchDelete}
        title="Delete selected annotations?"
        description={`This will permanently delete ${selectedAnnotationIds.size} annotation(s). This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous
        isLoading={isBatchDeleting}
        onConfirm={handleBatchDelete}
        onCancel={() => setConfirmBatchDelete(false)}
      />
    </div>
  );
};
