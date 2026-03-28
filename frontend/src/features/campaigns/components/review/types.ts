export type SortOption = 'default' | 'confidence-asc' | 'confidence-desc' | 'id-asc' | 'id-desc';

export type StatusFilter = 'all' | 'pending' | 'partial' | 'conflicting' | 'done' | 'skipped';

export interface UserInfo {
  id: string;
  email: string | null;
  displayName: string | null;
}
