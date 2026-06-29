// Vitest setup: provide window global for stores that attach debug refs in test mode
if (typeof window === 'undefined') {
  (globalThis as Record<string, unknown>).window = globalThis;
}
