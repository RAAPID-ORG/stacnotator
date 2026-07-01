import type { TaskStatus } from '~/shared/utils/taskStatus';

export const SORT_OPTIONS = [
  'default',
  'confidence-asc',
  'confidence-desc',
  'id-asc',
  'id-desc',
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];
export const isSortOption = (v: string): v is SortOption =>
  (SORT_OPTIONS as readonly string[]).includes(v);

/** Status options for the review filter UI - every TaskStatus plus an 'all' sentinel. */
export type StatusFilter = TaskStatus | 'all';

export interface UserInfo {
  id: string;
  email: string | null;
  displayName: string | null;
}
