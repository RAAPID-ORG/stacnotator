import type { ListAnnotationsForCampaignData } from '~/api/client';
import { isSortOption, type SortOption } from './types';

/** What narrows and orders a campaign's annotations, shared by the review table and
 *  Explore's annotation stepper so both walk the same list. */
export interface AnnotationFilterState {
  sort: SortOption;
  labelIds: number[];
  userIds: string[];
  /** 0 is "no rating". */
  confidences: number[];
  flaggedOnly: boolean;
}

export const NO_ANNOTATION_FILTERS: AnnotationFilterState = {
  sort: 'default',
  labelIds: [],
  userIds: [],
  confidences: [],
  flaggedOnly: false,
};

type AnnotationQuery = NonNullable<ListAnnotationsForCampaignData['query']>;

export function annotationFilterQuery(filters: AnnotationFilterState): AnnotationQuery {
  return {
    sort: filters.sort,
    flagged_only: filters.flaggedOnly,
    ...(filters.userIds.length ? { user_ids: filters.userIds } : {}),
    ...(filters.labelIds.length ? { label_ids: filters.labelIds } : {}),
    ...(filters.confidences.length ? { confidences: filters.confidences } : {}),
  };
}

const numbers = (raw: string | null): number[] =>
  (raw ?? '').split(',').filter(Boolean).map(Number).filter(Number.isFinite);

export function annotationFiltersToParams(
  filters: AnnotationFilterState,
  params: URLSearchParams
): void {
  if (filters.sort !== 'default') params.set('sort', filters.sort);
  if (filters.labelIds.length) params.set('labels', filters.labelIds.join(','));
  if (filters.userIds.length) params.set('users', filters.userIds.join(','));
  if (filters.confidences.length) params.set('confidence', filters.confidences.join(','));
  if (filters.flaggedOnly) params.set('flagged', 'true');
}

export function annotationFiltersFromParams(params: URLSearchParams): AnnotationFilterState {
  const sort = params.get('sort') ?? '';
  return {
    sort: isSortOption(sort) ? sort : 'default',
    labelIds: numbers(params.get('labels')),
    userIds: (params.get('users') ?? '').split(',').filter(Boolean),
    confidences: numbers(params.get('confidence')),
    flaggedOnly: params.get('flagged') === 'true',
  };
}
