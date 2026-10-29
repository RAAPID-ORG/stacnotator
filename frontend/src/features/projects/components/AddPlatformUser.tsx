import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ProjectUserOut, UserOut } from '~/api/client';
import { addProjectUsersByIdsMutation, listUsersOptions } from '~/api/queries';
import { useAccountStore } from '~/shared/stores/account.store';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Button, Field, Input } from '~/shared/ui/forms';
import { searchUsers } from '~/shared/utils/utility';

const NO_USERS: UserOut[] = [];

/** Emails only reach platform admins, so everyone else picks members by name. */
const pickerLabel = (user: UserOut) =>
  user.email ? `${user.display_name} (${user.email})` : user.display_name;

interface AddPlatformUserProps {
  projectId: number;
  members: ProjectUserOut[];
  onAdded: () => void;
}

/** Pick someone already on the platform and add them to the project. */
export const AddPlatformUser = ({ projectId, members, onAdded }: AddPlatformUserProps) => {
  const { t } = useTranslation('projects');
  const showAlert = useLayoutStore((state) => state.showAlert);
  const showEmails = useAccountStore((state) => state.account?.is_platform_admin ?? false);

  const [selectedUserId, setSelectedUserId] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);

  const platformUsers = useQuery({
    ...listUsersOptions({}),
    meta: { errorMessage: t('members.loadUsersFailed') },
  });

  // Platform admins get the raw records, where the username is null until the
  // person has picked one; the picker needs something to show.
  const allUsers = useMemo(
    () =>
      (platformUsers.data ?? NO_USERS).map((user) => ({
        ...user,
        display_name: user.display_name || (user.email ?? t('members.unnamedUser')),
      })),
    [platformUsers.data, t]
  );

  useEffect(() => {
    if (!pickerOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && pickerRef.current && !pickerRef.current.contains(target)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    document
      .getElementById(`project-user-option-${activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [pickerOpen, activeIndex]);

  const addById = useMutation({
    ...addProjectUsersByIdsMutation(),
    meta: { errorMessage: t('members.addFailed') },
    onSuccess: () => {
      onAdded();
      setSelectedUserId('');
      setUserQuery('');
    },
  });
  const addingUser = addById.isPending;

  const handleAddUser = () => {
    const selectedUser = allUsers.find((u) => u.id === selectedUserId);
    if (!selectedUser) return;
    addById.mutate(
      { path: { project_id: projectId }, body: { user_ids: [selectedUser.id] } },
      {
        onSuccess: () =>
          showAlert(t('members.addedToProject', { name: selectedUser.display_name }), 'success'),
      }
    );
  };

  const availableUsers = allUsers.filter((u) => !members.some((pu) => pu.user.id === u.id));

  // Once a user is picked the input holds their label; ignore it as a filter
  // so reopening the picker shows the full list again.
  const matchingUsers = searchUsers(availableUsers, (u) => u, selectedUserId ? '' : userQuery);
  const activeUserIndex = Math.min(activeIndex, Math.max(matchingUsers.length - 1, 0));

  const pickUser = (user: UserOut) => {
    setSelectedUserId(user.id);
    setUserQuery(pickerLabel(user));
    setPickerOpen(false);
  };

  return (
    <div className="flex gap-3 items-end">
      <Field label={t('members.selectUser')} htmlFor="project-user-search" className="flex-1">
        <div className="relative" ref={pickerRef}>
          <Input
            id="project-user-search"
            role="combobox"
            aria-expanded={pickerOpen}
            aria-controls="project-user-listbox"
            aria-autocomplete="list"
            aria-activedescendant={
              pickerOpen && matchingUsers.length > 0
                ? `project-user-option-${activeUserIndex}`
                : undefined
            }
            value={userQuery}
            onChange={(e) => {
              setUserQuery(e.target.value);
              setSelectedUserId('');
              setActiveIndex(0);
              setPickerOpen(true);
            }}
            onFocus={() => setPickerOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setPickerOpen(false);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (pickerOpen) {
                  setActiveIndex(Math.min(activeUserIndex + 1, matchingUsers.length - 1));
                } else {
                  setPickerOpen(true);
                }
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex(Math.max(activeUserIndex - 1, 0));
              } else if (e.key === 'Enter' && pickerOpen && matchingUsers[activeUserIndex]) {
                e.preventDefault();
                pickUser(matchingUsers[activeUserIndex]);
              }
            }}
            placeholder={
              availableUsers.length === 0
                ? t('members.noUsersAvailable')
                : showEmails
                  ? t('members.searchNameEmail')
                  : t('members.searchName')
            }
            disabled={addingUser || availableUsers.length === 0}
          />
          {pickerOpen && availableUsers.length > 0 && (
            <div
              id="project-user-listbox"
              role="listbox"
              className="absolute z-20 mt-1 w-full bg-white border border-neutral-300 rounded-lg shadow-lg max-h-64 overflow-y-auto"
            >
              {matchingUsers.length === 0 ? (
                <p className="px-3 py-2 text-xs text-neutral-500">{t('members.noMatches')}</p>
              ) : (
                matchingUsers.map((user, index) => (
                  <button
                    key={user.id}
                    id={`project-user-option-${index}`}
                    role="option"
                    aria-selected={user.id === selectedUserId}
                    type="button"
                    onClick={() => pickUser(user)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                      index === activeUserIndex ? 'bg-brand-50' : ''
                    } ${user.id === selectedUserId ? 'text-brand-800' : 'text-neutral-900'}`}
                  >
                    <div className="font-medium">{user.display_name}</div>
                    {user.email && <div className="text-neutral-500">{user.email}</div>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </Field>
      <Button onClick={handleAddUser} disabled={addingUser || !selectedUserId}>
        {addingUser ? t('members.adding') : t('members.addMember')}
      </Button>
    </div>
  );
};
