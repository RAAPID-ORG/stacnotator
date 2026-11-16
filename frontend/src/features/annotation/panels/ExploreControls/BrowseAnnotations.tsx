import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useAnnotationFacets } from '~/features/campaigns/hooks/campaignQueries';
import { AnnotationFilters } from '~/features/campaigns/components/review/AnnotationFilters';
import { NO_ANNOTATION_FILTERS } from '~/features/campaigns/components/review/annotationFilterState';
import { useAccountStore } from '~/shared/stores/account.store';
import { IconChevronLeft, IconChevronRight, IconFilter } from '~/shared/ui/Icons';
import { useHotkeyTip } from '../../hotkeys';
import { useBrowseStore } from '../../stores/browse';
import { useCampaign } from '../../stores/campaign';

/** Mounted only while open, so the annotator list is fetched only when it is wanted. */
function BrowseFilters() {
  const campaign = useCampaign();
  const currentUserId = useAccountStore((s) => s.account?.id);
  const facets = useAnnotationFacets(campaign.id);
  const filters = useBrowseStore((s) => s.filters);
  const users = (facets?.annotators ?? []).map((a) => ({
    id: a.user_id,
    email: a.email ?? null,
    displayName: a.display_name ?? null,
  }));

  return (
    <AnnotationFilters
      compact
      value={filters}
      onChange={useBrowseStore.getState().setFilters}
      labels={campaign.settings.labels}
      users={users}
      currentUserId={currentUserId}
    />
  );
}

const stepButton =
  'flex h-6 w-6 items-center justify-center rounded border border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40';

export function BrowseAnnotations() {
  const { t } = useTranslation('panels');
  const hotkeyTip = useHotkeyTip();
  const [showFilters, setShowFilters] = useState(false);
  const { filters, position, total, busy } = useBrowseStore(
    useShallow((s) => ({ filters: s.filters, position: s.position, total: s.total, busy: s.busy }))
  );
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_ANNOTATION_FILTERS);

  useEffect(() => {
    if (total === null) void useBrowseStore.getState().refreshTotal();
  }, [total, filters]);

  const step = (delta: 1 | -1) => void useBrowseStore.getState().step(delta);

  return (
    <div
      data-testid="browse-annotations"
      className="shrink-0 flex flex-col gap-1.5 px-2 py-2 border-t border-neutral-200 bg-neutral-50/60"
    >
      {showFilters && <BrowseFilters />}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={busy || position === null || position === 0}
          aria-label={t('browse.previous')}
          title={hotkeyTip('w', t('browse.previous'))}
          data-testid="browse-previous"
          className={stepButton}
        >
          <IconChevronLeft className="h-3 w-3" />
        </button>
        <span
          className="flex-1 text-center text-[11px] text-neutral-600 tabular-nums"
          title={t('browse.title')}
          data-testid="browse-position"
        >
          {total === null
            ? '…'
            : position === null
              ? t('browse.count', { count: total })
              : t('browse.position', { n: position + 1, total })}
        </span>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={
            busy || total === 0 || (position !== null && total !== null && position >= total - 1)
          }
          aria-label={t('browse.next')}
          title={hotkeyTip('s', t('browse.next'))}
          data-testid="browse-next"
          className={stepButton}
        >
          <IconChevronRight className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          aria-pressed={showFilters}
          aria-label={t('browse.filters')}
          title={t('browse.filters')}
          data-testid="browse-filters-toggle"
          className={`${stepButton} ${showFilters || filtered ? '!text-brand-700 !border-brand-300' : ''}`}
        >
          <IconFilter className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
