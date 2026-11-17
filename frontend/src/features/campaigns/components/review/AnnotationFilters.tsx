import { useTranslation } from 'react-i18next';
import type { LabelBase } from '~/api/client';
import { IconFlag } from '~/shared/ui/Icons';
import { UserFilterDropdown } from './UserFilterDropdown';
import { isSortOption, type UserInfo } from './types';
import type { AnnotationFilterState } from './annotationFilterState';

const toggled = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

interface AnnotationFiltersProps {
  value: AnnotationFilterState;
  onChange: (next: AnnotationFilterState) => void;
  labels: LabelBase[];
  users: UserInfo[];
  currentUserId: string | undefined;
  /** The narrow form for a side panel. */
  compact?: boolean;
}

export function AnnotationFilters({
  value,
  onChange,
  labels,
  users,
  currentUserId,
  compact = false,
}: AnnotationFiltersProps) {
  const { t } = useTranslation('review');
  const set = (patch: Partial<AnnotationFilterState>) => onChange({ ...value, ...patch });

  const labelCls = compact
    ? 'w-16 shrink-0 pt-0.5 text-[11px] font-medium text-neutral-600'
    : 'text-sm font-medium text-neutral-700';
  const chip = (active: boolean) =>
    `${compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-3 py-1.5 text-sm'} rounded-md transition-colors cursor-pointer ${
      active ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
    }`;
  const group = compact ? 'flex items-start gap-2' : 'flex items-center gap-2';

  return (
    <div
      className={compact ? 'flex flex-col gap-1.5' : 'flex flex-wrap items-center gap-4'}
      data-testid="annotation-filters"
    >
      {labels.length > 0 && (
        <div className={group}>
          <label className={labelCls}>{t('annotations.labelFilter')}</label>
          <div className={`flex gap-1 flex-wrap ${compact ? 'min-w-0 flex-1' : ''}`}>
            <button
              type="button"
              onClick={() => set({ labelIds: [] })}
              className={chip(value.labelIds.length === 0)}
            >
              {t('all')}
            </button>
            {labels.map((label) => (
              <button
                type="button"
                key={label.id}
                onClick={() => set({ labelIds: toggled(value.labelIds, label.id) })}
                className={chip(value.labelIds.includes(label.id))}
              >
                {label.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <UserFilterDropdown
        users={users}
        selectedUserIds={value.userIds}
        setSelectedUserIds={(userIds) => set({ userIds })}
        currentUserId={currentUserId}
        compact={compact}
      />

      <div className={group}>
        <label className={labelCls}>{t('annotations.confidenceFilter')}</label>
        <div className={`flex gap-1 flex-wrap ${compact ? 'min-w-0 flex-1' : ''}`}>
          <button
            type="button"
            onClick={() => set({ confidences: [] })}
            className={chip(value.confidences.length === 0)}
          >
            {t('all')}
          </button>
          {[1, 2, 3, 4, 5].map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => set({ confidences: toggled(value.confidences, c) })}
              className={chip(value.confidences.includes(c))}
            >
              {c}
            </button>
          ))}
          <button
            type="button"
            onClick={() => set({ confidences: toggled(value.confidences, 0) })}
            className={chip(value.confidences.includes(0))}
            title={t('annotations.noRatingTitle')}
          >
            {t('noRating')}
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => set({ flaggedOnly: !value.flaggedOnly })}
        className={`flex items-center gap-1.5 ${
          compact ? 'self-start ml-[4.5rem] px-1.5 py-0.5 text-[11px]' : 'px-3 py-1.5 text-sm'
        } rounded-md transition-colors border cursor-pointer ${
          value.flaggedOnly
            ? 'bg-rose-100 text-rose-800 border-rose-300'
            : 'bg-neutral-100 text-neutral-700 border-transparent hover:bg-neutral-200'
        }`}
        title={t('annotations.flaggedOnlyTitle')}
      >
        <IconFlag className="w-3.5 h-3.5" />
        <span>{t('flaggedOnly')}</span>
      </button>

      <div className={group}>
        <label className={labelCls}>{t('annotations.sortBy')}</label>
        <select
          value={value.sort}
          onChange={(e) => {
            if (isSortOption(e.target.value)) set({ sort: e.target.value });
          }}
          className={`${
            compact ? 'min-w-0 flex-1 px-1 py-0.5 text-[11px]' : 'px-3 py-1.5 text-sm'
          } border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white`}
        >
          <option value="default">{t('sort.default')}</option>
          <option value="time-desc">{t('sort.newestFirst')}</option>
          <option value="time-asc">{t('sort.oldestFirst')}</option>
          <option value="confidence-asc">{t('sort.confidenceAsc')}</option>
          <option value="confidence-desc">{t('sort.confidenceDesc')}</option>
          <option value="id-asc">{t('sort.idAsc')}</option>
          <option value="id-desc">{t('sort.idDesc')}</option>
        </select>
      </div>
    </div>
  );
}
