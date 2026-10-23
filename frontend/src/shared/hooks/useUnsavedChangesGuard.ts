import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router-dom';
import { useLayoutStore } from '~/shared/stores/layout.store';

interface GuardOptions {
  title?: string;
  description?: string;
}

// Warn before leaving while `when` is true (e.g. a form has unsaved edits).
export function useUnsavedChangesGuard(when: boolean, options?: GuardOptions) {
  const { t } = useTranslation();
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);
  const blocker = useBlocker(when);

  const title = options?.title ?? t('unsavedChanges.title');
  const description = options?.description ?? t('unsavedChanges.description');

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let active = true;
    showConfirmDialog({
      title,
      description,
      confirmText: t('unsavedChanges.stay'),
      cancelText: t('unsavedChanges.leave'),
    }).then((stay) => {
      if (!active) return;
      if (stay) blocker.reset();
      else blocker.proceed();
    });
    return () => {
      active = false;
    };
  }, [blocker, showConfirmDialog, title, description, t]);

  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);
}
