export type SourceGroup = { id: number; startIdx: number; count: number };

type MinimalSource = {
  id: number;
  visualizations: unknown[];
  collections: { id: number }[];
};

type MinimalView = {
  collection_refs: { collection_id: number; source_id: number }[];
};

type SourceStateRecord = { sourceId: number; collectionId: number; layerIndex: number };

type CycleSourceState = {
  selectedLayerIndex: number;
  showBasemap: boolean;
  activeCollectionId: number | null;
  selectedBasemapId: string | null;
  lastSourceState: Record<number, { collectionId: number; layerIndex: number }>;
};

export type CycleSourceResult =
  | { action: 'switch-to-basemap'; basemapId: string; recordState?: SourceStateRecord }
  | {
      action: 'switch-to-source';
      layerIndex: number;
      collectionId: number | undefined;
      recordState?: SourceStateRecord;
    }
  | { action: 'noop' };

export function buildSourceGroups(
  sources: MinimalSource[],
  viewSourceIds: Set<number>
): SourceGroup[] {
  const groups: SourceGroup[] = [];
  let offset = 0;
  for (const src of sources) {
    if (viewSourceIds.size > 0 && !viewSourceIds.has(src.id)) {
      offset += src.visualizations.length;
      continue;
    }
    groups.push({ id: src.id, startIdx: offset, count: src.visualizations.length });
    offset += src.visualizations.length;
  }
  return groups;
}

export function computeCycleSource(
  sourceGroups: SourceGroup[],
  basemapIds: string[],
  sources: MinimalSource[],
  selectedView: MinimalView,
  state: CycleSourceState
): CycleSourceResult {
  const {
    selectedLayerIndex,
    showBasemap,
    activeCollectionId,
    selectedBasemapId,
    lastSourceState,
  } = state;

  const totalEntries = sourceGroups.length + basemapIds.length;
  if (totalEntries <= 1) return { action: 'noop' };

  let currentEntryIdx: number;
  if (showBasemap) {
    const bmIdx = basemapIds.indexOf(selectedBasemapId ?? '');
    currentEntryIdx = sourceGroups.length + Math.max(0, bmIdx);
  } else {
    const srcByCollection = sources.find((s) =>
      s.collections.some((c) => c.id === activeCollectionId)
    );
    currentEntryIdx = srcByCollection
      ? sourceGroups.findIndex((g) => g.id === srcByCollection.id)
      : sourceGroups.findIndex(
          (g) => selectedLayerIndex >= g.startIdx && selectedLayerIndex < g.startIdx + g.count
        );
    if (currentEntryIdx === -1) currentEntryIdx = 0;
  }

  let stateToRecord: SourceStateRecord | undefined;
  if (!showBasemap && activeCollectionId !== null) {
    const currentSrc = sources.find((s) => s.collections.some((c) => c.id === activeCollectionId));
    if (currentSrc) {
      stateToRecord = {
        sourceId: currentSrc.id,
        collectionId: activeCollectionId,
        layerIndex: selectedLayerIndex,
      };
    }
  }

  const nextEntryIdx = (currentEntryIdx + 1) % totalEntries;

  if (nextEntryIdx >= sourceGroups.length) {
    const bmIdx = nextEntryIdx - sourceGroups.length;
    return {
      action: 'switch-to-basemap',
      basemapId: basemapIds[bmIdx],
      recordState: stateToRecord,
    };
  }

  const nextGroup = sourceGroups[nextEntryIdx];
  const targetSource = sources.find((s) => s.id === nextGroup.id);
  if (!targetSource) return { action: 'noop' };

  const remembered = lastSourceState[targetSource.id];
  const canRestore =
    !!remembered &&
    targetSource.collections.some((c) => c.id === remembered.collectionId) &&
    selectedView.collection_refs.some((r) => r.collection_id === remembered.collectionId);

  const layerIndex = canRestore ? remembered.layerIndex : nextGroup.startIdx;
  const collectionId = canRestore
    ? remembered.collectionId
    : selectedView.collection_refs.find((r) => r.source_id === targetSource.id)?.collection_id;

  return { action: 'switch-to-source', layerIndex, collectionId, recordState: stateToRecord };
}

export function computeCycleVisualization(
  sourceGroups: SourceGroup[],
  sources: MinimalSource[],
  selectedLayerIndex: number,
  activeCollectionId: number | null,
  showBasemap: boolean
): number | null {
  if (showBasemap || sourceGroups.length === 0) return null;

  const activeSrc = sources.find((s) => s.collections.some((c) => c.id === activeCollectionId));
  if (!activeSrc) return null;

  const activeGroup = sourceGroups.find((g) => g.id === activeSrc.id);
  if (!activeGroup || activeGroup.count <= 1) return null;

  const posInGroup = Math.max(0, selectedLayerIndex - activeGroup.startIdx);
  const clampedPos = Math.min(posInGroup, activeGroup.count - 1);
  const nextPos = (clampedPos + 1) % activeGroup.count;
  return activeGroup.startIdx + nextPos;
}
