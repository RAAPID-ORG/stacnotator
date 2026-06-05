import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { useLayoutStore } from '~/features/layout/layout.store';

interface GuardOptions {
  title?: string;
  description?: string;
}

// Warn before leaving while `when` is true (e.g. a form has unsaved edits).
export function useUnsavedChangesGuard(when: boolean, options?: GuardOptions) {
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);
  const blocker = useBlocker(when);

  const title = options?.title ?? 'Unsaved changes';
  const description =
    options?.description ?? 'You have unsaved changes that will be lost. Leave without saving?';

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let active = true;
    showConfirmDialog({
      title,
      description,
      confirmText: 'Stay',
      cancelText: 'Leave',
    }).then((stay) => {
      if (!active) return;
      if (stay) blocker.reset();
      else blocker.proceed();
    });
    return () => {
      active = false;
    };
  }, [blocker, showConfirmDialog, title, description]);

  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);
}
