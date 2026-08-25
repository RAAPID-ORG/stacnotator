import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Delayed } from '~/shared/ui/Delayed';
import { Skeleton, SkeletonRows } from '~/shared/ui/Skeleton';
import {
  batchDeleteAnnotations,
  getAnnotationFacets,
  listAnnotationsForCampaign,
  type AnnotationFacetsOut,
  type AnnotationListItemOut,
  type CampaignSummaryOut,
} from '~/api/client';
import { campaignPath } from '~/app/routes';
import { useAccountStore } from '~/shared/stores/account.store';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { capitalizeFirst } from '~/shared/utils/utility';
import { handleError } from '~/shared/utils/errorHandler';
import { OpenModeDistributionMap } from './OpenModeDistributionMap';
import { ExportDropdown } from './ExportDropdown';
import { Button } from '~/shared/ui/forms';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { UserFilterDropdown } from './UserFilterDropdown';
import { IconFlag } from '~/shared/ui/Icons';
import { Tooltip } from '~/shared/ui/Tooltip';
import { isSortOption, type SortOption, type UserInfo } from './types';
import { FadeIn } from '~/shared/ui/motion';
import { listRowCls, tableHeadRowCls } from '~/shared/ui/listRow';
import type { ReactNode } from 'react';

// Matches the server's own cap on a page; large enough that most campaigns are one or
// two pages, small enough that a page renders instantly.
const PAGE_SIZE = 50;

interface OpenModeReviewProps {
  campaign: CampaignSummaryOut;
  campaignId: number;
  // Extra action rendered first in the header row (e.g. the import toggle).
  headerActions?: ReactNode;
  // Rendered directly below the header (e.g. the expanded import section).
  subHeader?: ReactNode;
}

export const OpenModeReview = ({
  campaign,
  campaignId,
  headerActions,
  subHeader,
}: OpenModeReviewProps) => {
  const navigate = useNavigate();
  const annotatePath = campaignPath(campaign.project_id, campaignId, 'annotate');
  const currentUser = useAccountStore((state) => state.account);
  const showAlert = useLayoutStore((state) => state.showAlert);

  // One page of rows, plus the campaign-wide counts the filters and legend need. The
  // page used to hold every annotation in state and filter in the browser, which meant
  // a 70 MB request before anything rendered.
  const [items, setItems] = useState<AnnotationListItemOut[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<AnnotationFacetsOut | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  // Distinct from `loading`: true only until the first page has ever arrived. After
  // that a refetch keeps the previous rows mounted rather than collapsing the page.
  const [hasLoaded, setHasLoaded] = useState(false);

  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<number[]>([]);
  const [selectedConfidences, setSelectedConfidences] = useState<number[]>([]);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // What actually goes to the server. Typing re-queries on every keystroke otherwise,
  // and each answer rewrites the table under the reader's cursor.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('default');

  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<Set<number>>(new Set());
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    getAnnotationFacets({ path: { campaign_id: campaignId } })
      .then((res) => setFacets(res.data ?? null))
      .catch((err) => handleError(err, 'Failed to load annotation summary'));
  }, [campaignId]);

  // One string standing for "what is being asked for". Changing any of it sends the
  // reader back to the first page: a narrowed filter would otherwise land them on an
  // offset past the end of its own results.
  const filterKey = JSON.stringify([
    selectedUserIds,
    selectedLabelIds,
    selectedConfidences,
    flaggedOnly,
    debouncedSearch,
    sortOption,
  ]);
  const appliedFilterKey = useRef(filterKey);

  useEffect(() => {
    setOffset((current) => (current === 0 ? current : 0));
  }, [campaignId, filterKey]);

  useEffect(() => {
    // Filters just changed but the offset reset has not landed yet. Fetching now would
    // briefly show page three of the new filter before page one replaces it.
    if (appliedFilterKey.current !== filterKey && offset !== 0) return;
    appliedFilterKey.current = filterKey;

    let cancelled = false;
    const loadPage = async () => {
      try {
        setLoading(true);
        const res = await listAnnotationsForCampaign({
          path: { campaign_id: campaignId },
          query: {
            limit: PAGE_SIZE,
            offset,
            sort: sortOption,
            flagged_only: flaggedOnly,
            ...(selectedUserIds.length ? { user_ids: selectedUserIds } : {}),
            ...(selectedLabelIds.length ? { label_ids: selectedLabelIds } : {}),
            ...(selectedConfidences.length ? { confidences: selectedConfidences } : {}),
            ...(debouncedSearch ? { search: debouncedSearch } : {}),
          },
        });
        // Responses can land out of order while someone types in the search box.
        if (cancelled) return;
        setItems(res.data?.items ?? []);
        setTotal(res.data?.total ?? 0);
        setHasLoaded(true);
      } catch (err) {
        if (!cancelled) handleError(err, 'Failed to load annotations');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadPage();
    return () => {
      cancelled = true;
    };
    // filterKey stands for every filter input; listing them individually would re-run
    // this on each render, since two of them are arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, offset, filterKey]);

  const uniqueUsers = useMemo(
    (): UserInfo[] =>
      (facets?.annotators ?? []).map((a) => ({
        id: a.user_id,
        email: a.email ?? null,
        displayName: a.display_name ?? null,
      })),
    [facets]
  );

  const labels = campaign.settings.labels;

  const stats = {
    total: facets?.total ?? 0,
    withConfidence: facets?.with_confidence ?? 0,
  };

  const isCampaignAdmin = campaign.viewer_is_admin ?? false;

  // Mirror backend rule (annotation/service.py:delete_annotations_bulk):
  // public campaigns require ownership unless admin; private campaigns let any
  // member with access delete anything.
  const canDeleteAnnotation = (ann: AnnotationListItemOut): boolean => {
    if (!campaign.is_public) return true;
    return isCampaignAdmin || ann.created_by_user_id === currentUser?.id;
  };

  // Selection is scoped to the page on screen. Select-all across a filter that can
  // match 100k rows is not something the reader can meaningfully review before
  // confirming a delete, so it deliberately does not exist.
  const deletablePageIds = useMemo(
    () => items.filter(canDeleteAnnotation).map((a) => a.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, isCampaignAdmin, currentUser?.id, campaign.is_public]
  );

  // Drop selections that are no longer on screen after a filter, sort or page change.
  useEffect(() => {
    setSelectedAnnotationIds((prev) => {
      const visible = new Set(items.map((a) => a.id));
      let changed = false;
      const next = new Set<number>();
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [items]);

  const toggleAnnotationSelected = (id: number) => {
    setSelectedAnnotationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allDeletableSelected =
    deletablePageIds.length > 0 && deletablePageIds.every((id) => selectedAnnotationIds.has(id));

  const toggleSelectAllDeletable = () => {
    setSelectedAnnotationIds((prev) => {
      if (allDeletableSelected) {
        const next = new Set(prev);
        deletablePageIds.forEach((id) => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      deletablePageIds.forEach((id) => next.add(id));
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
      setItems((prev) => prev.filter((a) => !idSet.has(a.id)));
      setTotal((prev) => Math.max(0, prev - data.deleted_count));
      setSelectedAnnotationIds(new Set());
      setConfirmBatchDelete(false);
      showAlert(`Deleted ${data.deleted_count} annotation(s)`, 'success');
    } catch (err) {
      handleError(err, 'Failed to delete annotations');
    } finally {
      setIsBatchDeleting(false);
    }
  };

  // Open the annotator where the annotation came from: task-bound ones jump
  // to their task in Tasks mode, standalone ones open Explore centred on the
  // annotation. Without an explicit mode the annotator would seed from
  // campaign.mode and open the first task regardless of origin.
  const handleNavigateToAnnotation = (ann: AnnotationListItemOut) => {
    if (ann.annotation_task_id != null) {
      navigate(`${annotatePath}?task=${ann.annotation_task_id}&review=true`);
      return;
    }
    // The centroid comes from the database now; the row never carries a geometry.
    if (ann.centroid_lat != null && ann.centroid_lon != null) {
      navigate(
        `${annotatePath}?mode=explore&lat=${ann.centroid_lat}&lon=${ann.centroid_lon}&annotation=${ann.id}`
      );
    } else {
      navigate(`${annotatePath}?mode=explore`);
    }
  };

  const getUserDisplayName = (ann: AnnotationListItemOut): string => {
    if (currentUser && ann.created_by_user_id === currentUser.id)
      return currentUser.display_name || currentUser.email || 'You';
    return (
      ann.created_by_user_display_name ||
      ann.created_by_user_email ||
      ann.created_by_user_id.substring(0, 8)
    );
  };

  const getLabelName = (labelId: number | null): string => {
    if (labelId === null) return 'No label';
    const label = labels.find((l) => l.id === labelId);
    return label?.name || `Label #${labelId}`;
  };

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">{capitalizeFirst(campaign.name)} - Annotations</h1>
            {loading ? (
              <Skeleton className="h-4 w-56 mt-2" />
            ) : (
              <p className="page-subtitle">
                {stats.total} annotation{stats.total !== 1 ? 's' : ''} in this campaign.
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <ExportDropdown
              campaignId={campaignId}
              campaign={campaign}
              disabled={stats.total === 0}
              showMergeToggle={false}
            />
            <Button onClick={() => navigate(annotatePath)}>Start annotating</Button>
          </div>
        </header>

        {subHeader}

        {/* Map */}
        {stats.total > 0 && (
          <div className="surface mb-6">
            <div className="px-5 py-4 border-b border-neutral-100">
              <h2 className="section-heading">
                Annotation locations{' '}
                <span className="text-neutral-400 font-normal">({stats.total})</span>
              </h2>
            </div>
            <div className="p-4">
              <OpenModeDistributionMap
                campaignId={campaignId}
                labelCounts={facets?.labels ?? []}
                labels={labels}
                bbox={{
                  west: campaign.settings.bbox_west,
                  south: campaign.settings.bbox_south,
                  east: campaign.settings.bbox_east,
                  north: campaign.settings.bbox_north,
                }}
              />
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="surface surface-unclipped mb-6">
          <div className="px-5 py-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="section-heading mb-0">Filters &amp; search</h3>
              {headerActions}
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
                  onChange={(e) => {
                    if (isSortOption(e.target.value)) setSortOption(e.target.value);
                  }}
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
              {!hasLoaded ? (
                <Skeleton className="h-3.5 w-44" />
              ) : (
                <>
                  Showing {items.length === 0 ? 0 : offset + 1}&ndash;{offset + items.length} of{' '}
                  {total} annotations
                </>
              )}
            </div>
          </div>
        </div>

        {/* Annotations Table */}
        {!hasLoaded ? (
          <Delayed>
            <SkeletonRows count={8} />
          </Delayed>
        ) : items.length === 0 ? (
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
              {stats.total === 0 ? 'No annotations yet' : 'No annotations match your filters'}
            </p>
            <p className="text-neutral-500 text-sm">
              {stats.total === 0
                ? 'Start annotating to see entries here'
                : 'Try adjusting your filter criteria'}
            </p>
          </div>
        ) : (
          // Dimmed rather than replaced while the next page loads: the rows keep their
          // height, so nothing under the reader's cursor moves.
          <div
            aria-busy={loading}
            className={`overflow-x-auto border border-neutral-200 rounded-xl shadow-sm bg-white transition-opacity duration-150 ${
              loading ? 'opacity-60' : 'opacity-100'
            }`}
          >
            {/* Batch actions toolbar - shown only when there are selectable rows */}
            {deletablePageIds.length > 0 && (
              <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-neutral-200 bg-neutral-50">
                <span className="text-xs text-neutral-600">
                  {selectedAnnotationIds.size > 0
                    ? `${selectedAnnotationIds.size} selected`
                    : `Select annotations to delete (${deletablePageIds.length} available)`}
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
                <tr className={tableHeadRowCls}>
                  <th className="px-3 py-3 text-left">
                    <input
                      type="checkbox"
                      aria-label="Select all deletable annotations"
                      checked={allDeletableSelected}
                      onChange={toggleSelectAllDeletable}
                      disabled={deletablePageIds.length === 0}
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
                {items.map((ann, index) => {
                  const centroid =
                    ann.centroid_lat != null && ann.centroid_lon != null
                      ? { lat: ann.centroid_lat, lon: ann.centroid_lon }
                      : null;
                  const isMine = ann.created_by_user_id === currentUser?.id;
                  const createdAt = new Date(ann.created_at);
                  const canDelete = canDeleteAnnotation(ann);
                  const isSelected = selectedAnnotationIds.has(ann.id);

                  return (
                    <tr
                      key={ann.id}
                      className={listRowCls(index, {
                        tinted: isMine,
                      })}
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
                        {getUserDisplayName(ann)}
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
                          <Tooltip text={ann.comment}>
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
                          </Tooltip>
                        ) : (
                          <span className="text-neutral-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {ann.flagged_for_review ? (
                          ann.flag_comment?.trim() ? (
                            <Tooltip text={ann.flag_comment} variant="danger">
                              <span className="inline-flex items-center text-rose-600">
                                <IconFlag className="w-4 h-4" />
                              </span>
                            </Tooltip>
                          ) : (
                            <span
                              className="inline-flex items-center text-rose-600"
                              title="Flagged for review"
                            >
                              <IconFlag className="w-4 h-4" />
                            </span>
                          )
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

        {/* Pager */}
        {total > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between gap-4">
            <Button
              variant="secondary"
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              disabled={offset === 0 || loading}
            >
              Previous
            </Button>
            <span className="text-sm text-neutral-600">
              Page{' '}
              <strong className="text-neutral-900">{Math.floor(offset / PAGE_SIZE) + 1}</strong> of{' '}
              {Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </span>
            <Button
              variant="secondary"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total || loading}
            >
              Next
            </Button>
          </div>
        )}

        {/* Footer */}
        {items.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-6 text-sm text-neutral-600">
            <span>
              Showing:{' '}
              <strong className="text-neutral-900">
                {offset + 1}&ndash;{offset + items.length}
              </strong>
            </span>
            <span>
              Matching: <strong className="text-neutral-900">{total}</strong>
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
