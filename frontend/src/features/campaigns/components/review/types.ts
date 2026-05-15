import type { TaskStatus } from '~/shared/utils/taskStatus';

export type SortOption = 'default' | 'confidence-asc' | 'confidence-desc' | 'id-asc' | 'id-desc';

/** Status options for the review filter UI - every TaskStatus plus an 'all' sentinel. */
export type StatusFilter = TaskStatus | 'all';

export interface UserInfo {
  id: string;
  email: string | null;
  displayName: string | null;
}
