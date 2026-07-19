/** Run `cb` when the browser is idle, so background warm-up work never competes
 *  with the current interaction. Falls back to a short timeout where
 *  requestIdleCallback is unavailable (Safari). Returns a cancel function. */
export function onIdle(cb: () => void, timeout = 2000): () => void {
  if (typeof window === 'undefined') return () => {};

  const ric = window.requestIdleCallback;
  if (ric) {
    const id = ric(cb, { timeout });
    return () => window.cancelIdleCallback?.(id);
  }

  const id = window.setTimeout(cb, 200);
  return () => window.clearTimeout(id);
}
