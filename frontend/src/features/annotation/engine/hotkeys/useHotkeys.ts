import { useEffect } from 'react';
import { registerBindings } from './registry';
import type { Binding, HotkeyScope } from './types';

/** Registers `table` under `scope` for as long as the calling component is
 *  mounted and `deps` stays referentially stable, re-registering whenever
 *  `deps` changes. Callers own the dependency list so a binding's `run`/`when`
 *  closures can capture fresh state the same way a plain useEffect would. */
export function useHotkeys(scope: HotkeyScope, table: Binding[], deps: unknown[]): void {
  useEffect(() => {
    return registerBindings(scope, table);
    // deps is caller-supplied by design rather than derived from scope/table
    // identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
