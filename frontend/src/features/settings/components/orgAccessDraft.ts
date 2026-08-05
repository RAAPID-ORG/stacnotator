/** Everything the per-row access editor may change, edited as one draft and
 *  applied together on Save so nothing flips on a bare click. */
export interface AccessDraft {
  organizationId: number;
  initialTilers: string[];
  selectedTilers: string[];
  internalStorage: boolean;
}

/** What Save must apply: each backend call fires only for a real change, so
 *  reopening the editor and saving untouched state is a no-op. */
export const accessDraftChanges = (draft: AccessDraft, currentInternalStorage: boolean) => ({
  tilersChanged:
    draft.selectedTilers.length !== draft.initialTilers.length ||
    draft.selectedTilers.some((name) => !draft.initialTilers.includes(name)),
  storageChanged: draft.internalStorage !== currentInternalStorage,
});
