import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { useLayoutStore } from '~/features/layout/layout.store';

interface GuardOptions {
  title?: string;
  description?: string;
}

/** Warn before leaving while `when` is true (e.g. a form has unsaved edits).
 *  In-app route changes are intercepted with the app confirm dialog; refreshes
 *  and tab-closes fall back to the browser's native prompt. Requires the data
 *  router (see app/router.tsx) for useBlocker to function. */
export function useUnsavedChangesGuard(when: boolean, options?: GuardOptions) {
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);
  const blocker = useBlocker(when);

  const title = options?.title ?? 'Unsaved changes';
  const description =
    options?.description ?? 'You have unsaved changes that will be lost. Leave without saving?';

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let active = true;
    // "Stay" is the primary (right, emphasised) action so the safe choice is the
    // obvious one; "Leave" is the muted secondary button.
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
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);
}
