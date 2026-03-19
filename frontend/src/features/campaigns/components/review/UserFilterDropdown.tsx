import { useState } from 'react';
import type { UserInfo } from './types';

interface UserFilterDropdownProps {
  users: UserInfo[];
  selectedUserIds: string[];
  setSelectedUserIds: (ids: string[]) => void;
  currentUserId: string | undefined;
}

export const UserFilterDropdown = ({
  users,
  selectedUserIds,
  setSelectedUserIds,
  currentUserId,
}: UserFilterDropdownProps) => {
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-neutral-700">Filter by User:</label>
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white min-w-[200px] text-left flex items-center justify-between hover:bg-neutral-50"
        >
          <span className="text-neutral-700">
            {selectedUserIds.length > 0
              ? `${selectedUserIds.length} user${selectedUserIds.length > 1 ? 's' : ''} selected`
              : 'All users'}
          </span>
          <svg className="w-4 h-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showDropdown && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
            <div className="absolute z-20 mt-1 w-64 bg-white border border-neutral-300 rounded-md shadow-lg max-h-80 overflow-y-auto">
              {selectedUserIds.length > 0 && (
                <div className="sticky top-0 bg-neutral-50 border-b border-neutral-200 px-3 py-2">
                  <button
                    onClick={() => setSelectedUserIds([])}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                  >
                    Clear all
                  </button>
                </div>
              )}
              <div className="py-1">
                {users.map((user) => {
                  const displayName = user.displayName || user.email || user.id.substring(0, 8);
                  const isSelected = selectedUserIds.includes(user.id);
                  const isCurrentUser = currentUserId === user.id;
                  return (
                    <label
                      key={user.id}
                      className="flex items-center px-3 py-2 hover:bg-neutral-50 cursor-pointer"
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
                        className="w-4 h-4 text-brand-600 border-neutral-300 rounded focus:ring-brand-500"
                      />
                      <span className="ml-2 text-sm text-neutral-700">
                        {isCurrentUser && <span className="font-medium text-brand-600">(You) </span>}
                        {displayName}
                      </span>
                    </label>
                  );
                })}
                {users.length === 0 && (
                  <div className="px-3 py-2 text-sm text-neutral-500">No users found</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
