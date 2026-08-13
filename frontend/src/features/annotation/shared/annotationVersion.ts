import { create } from 'zustand';

interface AnnotationVersionState {
  version: number;
}

const useStore = create<AnnotationVersionState>(() => ({ version: 0 }));

/** Number to add to the campaign's own annotations_version in a tile URL. */
export function useAnnotationVersion(): number {
  return useStore((s) => s.version);
}

export function bumpAnnotationVersion(): void {
  useStore.setState((s) => ({ version: s.version + 1 }));
}

/** Test/teardown seam. */
export function resetAnnotationVersion(): void {
  useStore.setState({ version: 0 });
}
