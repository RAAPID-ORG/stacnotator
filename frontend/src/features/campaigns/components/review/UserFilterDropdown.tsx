import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserInfo } from './types';

interface UserFilterDropdownProps {
  users: UserInfo[];
  selectedUserIds: string[];
  setSelectedUserIds: (ids: string[]) => void;
  currentUserId: string | undefined;
  compact?: boolean;
}

export const UserFilterDropdown = ({
  users,
  selectedUserIds,
  setSelectedUserIds,
  currentUserId,
  compact = false,
}: UserFilterDropdownProps) => {
  const { t } = useTranslation('review');
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <div className={compact ? 'flex items-start gap-2' : 'flex items-center gap-2'}>
      <label
        className={
          compact
            ? 'w-16 shrink-0 pt-0.5 text-[11px] font-medium text-neutral-600'
            : 'text-sm font-medium text-neutral-700'
        }
      >
        {t('userFilter.label')}
      </label>
      <div className={compact ? 'min-w-0 flex-1' : 'relative'}>
        <button
          type="button"
          onClick={() => setShowDropdown(!showDropdown)}
          className={`${
            compact ? 'w-full px-1.5 py-0.5 text-[11px]' : 'px-3 py-1.5 text-sm min-w-[200px]'
          } border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white text-left flex items-center justify-between hover:bg-neutral-50`}
        >
          <span className="text-neutral-700">
            {selectedUserIds.length > 0
              ? t('userFilter.selected', { count: selectedUserIds.length })
              : t('userFilter.allUsers')}
          </span>
          <svg
            className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} text-neutral-500`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showDropdown && (
          <>
            {/* In a side panel the list opens inline: a popover would be clipped by the panel. */}
            {!compact && (
              <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
            )}
            <div
              className={
                compact
                  ? 'mt-1 bg-white border border-neutral-200 rounded-md max-h-32 overflow-y-auto'
                  : 'absolute z-20 mt-1 w-64 bg-white border border-neutral-300 rounded-md shadow-lg max-h-80 overflow-y-auto'
              }
            >
              {selectedUserIds.length > 0 && (
                <div
                  className={`sticky top-0 bg-neutral-50 border-b border-neutral-200 ${compact ? 'px-1.5 py-0.5' : 'px-3 py-2'}`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedUserIds([])}
                    className="text-[11px] text-brand-600 hover:text-brand-700 font-medium"
                  >
                    {t('userFilter.clearAll')}
                  </button>
                </div>
              )}
              <div className={compact ? 'py-0.5' : 'py-1'}>
                {users.map((user) => {
                  const displayName = user.displayName || user.email || user.id.substring(0, 8);
                  const isSelected = selectedUserIds.includes(user.id);
                  const isCurrentUser = currentUserId === user.id;
                  return (
                    <label
                      key={user.id}
                      className={`flex items-center hover:bg-neutral-50 cursor-pointer ${compact ? 'px-1.5 py-0.5' : 'px-3 py-2'}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedUserIds([...selectedUserIds, user.id]);
                          } else {
                            setSelectedUserIds(selectedUserIds.filter((id) => id !== user.id));
                          }
                        }}
                        className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} shrink-0 text-brand-600 border-neutral-300 rounded focus:ring-brand-600`}
                      />
                      <span
                        className={`ml-2 truncate text-neutral-700 ${compact ? 'text-[11px]' : 'text-sm'}`}
                      >
                        {isCurrentUser && (
                          <span className="font-medium text-brand-600">{t('you')} </span>
                        )}
                        {displayName}
                      </span>
                    </label>
                  );
                })}
                {users.length === 0 && (
                  <div
                    className={`text-neutral-500 ${compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-3 py-2 text-sm'}`}
                  >
                    {t('userFilter.noUsers')}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
