import { useEffect, useRef, useCallback, useMemo } from 'react';
import { DIGIT_INPUT_TIMEOUT_MS } from '~/shared/utils/constants';
import { useLayoutStore } from '~/features/layout/layout.store';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';

interface UseAnnotationKeyboardOptions {
  commentInputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export const useAnnotationKeyboard = ({ commentInputRef }: UseAnnotationKeyboardOptions) => {
  const digitBuffer = useRef<string>('');
  const digitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const campaign = useCampaignStore((s) => s.campaign);
  const selectedViewId = useCampaignStore((s) => s.selectedViewId);
  const setSelectedViewId = useCampaignStore((s) => s.setSelectedViewId);

  const selectedLabelId = useTaskStore((s) => s.selectedLabelId);
  const comment = useTaskStore((s) => s.comment);
  const confidence = useTaskStore((s) => s.confidence);
  const isSubmitting = useTaskStore((s) => s.isSubmitting);
  const isNavigating = useTaskStore((s) => s.isNavigating);
  const visibleTasks = useTaskStore((s) => s.visibleTasks);
  const currentTaskIndex = useTaskStore((s) => s.currentTaskIndex);
  const nextTask = useTaskStore((s) => s.nextTask);
  const previousTask = useTaskStore((s) => s.previousTask);
  const setSelectedLabelId = useTaskStore((s) => s.setSelectedLabelId);
  const setConfidence = useTaskStore((s) => s.setConfidence);
  const submitAnnotation = useTaskStore((s) => s.submitAnnotation);

  const activeCollectionId = useMapStore((s) => s.activeCollectionId);
  const activeSliceIndex = useMapStore((s) => s.activeSliceIndex);
  const triggerRefocus = useMapStore((s) => s.triggerRefocus);
  const toggleCrosshair = useMapStore((s) => s.toggleCrosshair);
  const triggerZoomIn = useMapStore((s) => s.triggerZoomIn);
  const triggerZoomOut = useMapStore((s) => s.triggerZoomOut);
  const triggerPan = useMapStore((s) => s.triggerPan);
  const setActiveCollectionId = useMapStore((s) => s.setActiveCollectionId);
  const setActiveSliceIndex = useMapStore((s) => s.setActiveSliceIndex);
  const setSliceNavIntent = useMapStore((s) => s.setSliceNavIntent);
  const selectedLayerIndex = useMapStore((s) => s.selectedLayerIndex);
  const showBasemap = useMapStore((s) => s.showBasemap);
  const selectedBasemapId = useMapStore((s) => s.selectedBasemapId);
  const setSelectedLayerIndex = useMapStore((s) => s.setSelectedLayerIndex);
  const setShowBasemap = useMapStore((s) => s.setShowBasemap);
  const setSelectedBasemapId = useMapStore((s) => s.setSelectedBasemapId);
  const emptySlices = useMapStore((s) => s.emptySlices);
  const collectionSliceIndices = useMapStore((s) => s.collectionSliceIndices);

  const showAlert = useLayoutStore((s) => s.showAlert);
  const toggleKeyboardHelp = useLayoutStore((s) => s.toggleKeyboardHelp);
  const toggleGuide = useLayoutStore((s) => s.toggleGuide);

  const labels = useMemo(() => campaign?.settings.labels ?? [], [campaign?.settings.labels]);

  // Derive the selected view and its ordered collections
  const selectedView = campaign?.imagery_views.find((v) => v.id === selectedViewId);

  // Derive active source from activeCollectionId
  const activeSourceId = useMemo(() => {
    if (!campaign || !activeCollectionId) return null;
    return (
      campaign.imagery_sources.find((s) => s.collections.some((c) => c.id === activeCollectionId))
        ?.id ?? null
    );
  }, [campaign, activeCollectionId]);

  // Scoped to the active source so hotkeys stay within one source
  const viewCollections = useMemo(() => {
    if (!selectedView || !campaign) return [];
    return selectedView.collection_refs
      .filter((ref) => activeSourceId == null || ref.source_id === activeSourceId)
      .map((ref) => {
        const source = campaign.imagery_sources.find((s) =>
          s.collections.some((c) => c.id === ref.collection_id)
        );
        const collection = source?.collections.find((c) => c.id === ref.collection_id);
        if (!source || !collection) return null;
        return { ...ref, collection, source };
      })
      .filter(Boolean) as {
      collection_id: number;
      source_id: number;
      show_as_window: boolean;
      collection: { id: number; slices: { name: string }[] };
      source: { id: number };
    }[];
  }, [selectedView, campaign, activeSourceId]);

  // Current active collection and its position
  const currentCollectionIndex = viewCollections.findIndex(
    (c) => c.collection_id === activeCollectionId
  );
  const currentEntry = viewCollections[currentCollectionIndex];
  const currentSliceCount = Math.max(1, currentEntry?.collection.slices.length ?? 0);

  const firstNonEmptySlice = useCallback(
    (collectionId: number, totalSlices: number, preferredIndex = 0): number => {
      for (let offset = 0; offset < totalSlices; offset++) {
        const i = (preferredIndex + offset) % totalSlices;
        if (!emptySlices[`${collectionId}-${i}`]) return i;
      }
      return -1;
    },
    [emptySlices]
  );

  const selectLabelByIndex = useCallback(
    (index: number) => {
      if (index > 0 && index <= labels.length) {
        const targetLabelId = labels[index - 1].id;
        setSelectedLabelId(selectedLabelId === targetLabelId ? null : targetLabelId);
      }
    },
    [labels, setSelectedLabelId, selectedLabelId]
  );

  const processDigitBuffer = useCallback(() => {
    const num = parseInt(digitBuffer.current, 10);
    if (!isNaN(num) && num > 0) selectLabelByIndex(num);
    digitBuffer.current = '';
  }, [selectLabelByIndex]);

  const handleDigitInput = useCallback(
    (digit: string) => {
      if (digitTimeoutRef.current) {
        clearTimeout(digitTimeoutRef.current);
        digitTimeoutRef.current = null;
      }
      digitBuffer.current += digit;
      const currentNum = parseInt(digitBuffer.current, 10);
      const canAddMoreDigits = currentNum * 10 <= labels.length;
      if (currentNum > labels.length || !canAddMoreDigits || digitBuffer.current.length >= 2) {
        processDigitBuffer();
      } else {
        digitTimeoutRef.current = setTimeout(processDigitBuffer, DIGIT_INPUT_TIMEOUT_MS);
      }
    },
    [labels.length, processDigitBuffer]
  );

  // Navigate slices with collection wrap-around
  const navigateSlice = useCallback(
    (direction: 'next' | 'prev') => {
      if (!currentEntry) return;
      // Remember which direction the user travelled in, so that if the
      // landed-on slice later turns out empty (detected async by the probe),
      // we keep skipping in that same direction instead of jumping to cover.
      setSliceNavIntent(direction);
      const colId = currentEntry.collection_id;
      const nonEmpty: number[] = [];
      for (let i = 0; i < currentSliceCount; i++) {
        if (!emptySlices[`${colId}-${i}`]) nonEmpty.push(i);
      }

      if (direction === 'next') {
        const nextInCol = nonEmpty.find((i) => i > activeSliceIndex);
        if (nextInCol !== undefined) {
          setActiveSliceIndex(nextInCol);
        } else if (currentCollectionIndex < viewCollections.length - 1) {
          const next = viewCollections[currentCollectionIndex + 1];
          const nextCount = next.collection.slices.length;
          const landing = firstNonEmptySlice(next.collection_id, nextCount, 0);
          setActiveCollectionId(next.collection_id);
          if (landing > 0) setTimeout(() => setActiveSliceIndex(landing), 0);
        }
      } else {
        const prevInCol = [...nonEmpty].reverse().find((i) => i < activeSliceIndex);
        if (prevInCol !== undefined) {
          setActiveSliceIndex(prevInCol);
        } else if (currentCollectionIndex > 0) {
          const prev = viewCollections[currentCollectionIndex - 1];
          const prevCount = prev.collection.slices.length;
          let landing = -1;
          for (let i = prevCount - 1; i >= 0; i--) {
            if (!emptySlices[`${prev.collection_id}-${i}`]) {
              landing = i;
              break;
            }
          }
          if (landing < 0) return;
          setActiveCollectionId(prev.collection_id);
          setTimeout(() => setActiveSliceIndex(landing), 0);
        }
      }
    },
    [
      activeSliceIndex,
      currentSliceCount,
      currentCollectionIndex,
      currentEntry,
      viewCollections,
      emptySlices,
      setActiveSliceIndex,
      setActiveCollectionId,
      setSliceNavIntent,
      firstNonEmptySlice,
    ]
  );

  // Navigate collections directly (Shift+A/D)
  const navigateCollection = useCallback(
    (direction: 'next' | 'prev') => {
      if (viewCollections.length === 0) return;
      // Fresh collection: treat like an initial load so any empty-slice
      // probe lands on the cover slice rather than hotkey-direction-skipping.
      setSliceNavIntent('initial');
      const targetIdx =
        direction === 'next' ? currentCollectionIndex + 1 : currentCollectionIndex - 1;
      const target = viewCollections[targetIdx];
      if (!target) return;

      const storedSlice = collectionSliceIndices[target.collection_id] ?? 0;
      const isStoredEmpty = emptySlices[`${target.collection_id}-${storedSlice}`];
      setActiveCollectionId(target.collection_id);

      if (isStoredEmpty) {
        const fallback = firstNonEmptySlice(
          target.collection_id,
          target.collection.slices.length,
          storedSlice
        );
        if (fallback >= 0) setTimeout(() => setActiveSliceIndex(fallback), 0);
      }
    },
    [
      currentCollectionIndex,
      viewCollections,
      setActiveCollectionId,
      setActiveSliceIndex,
      setSliceNavIntent,
      firstNonEmptySlice,
      collectionSliceIndices,
      emptySlices,
    ]
  );

  // Pre-compute source → viz index ranges for I / Shift+I cycling
  const sourceGroups = useMemo(() => {
    const groups: { name: string; startIdx: number; count: number }[] = [];
    let offset = 0;
    for (const src of campaign?.imagery_sources ?? []) {
      groups.push({ name: src.name, startIdx: offset, count: src.visualizations.length });
      offset += src.visualizations.length;
    }
    return groups;
  }, [campaign?.imagery_sources]);

  const basemaps = useMemo(() => campaign?.basemaps ?? [], [campaign?.basemaps]);
  const basemapIds = useMemo(() => basemaps.map((b) => `basemap-${b.id}`), [basemaps]);

  /** I: cycle through imagery sources + individual basemaps (jump to first viz of next source) */
  const cycleSource = useCallback(() => {
    // Each imagery source group is one entry, each basemap is one entry
    const totalEntries = sourceGroups.length + basemapIds.length;
    if (totalEntries <= 1) return;

    let currentEntryIdx: number;
    if (showBasemap) {
      // Find which basemap is currently active
      const bmIdx = basemapIds.indexOf(selectedBasemapId ?? '');
      currentEntryIdx = sourceGroups.length + (bmIdx >= 0 ? bmIdx : 0);
    } else {
      currentEntryIdx = sourceGroups.findIndex(
        (g) => selectedLayerIndex >= g.startIdx && selectedLayerIndex < g.startIdx + g.count
      );
      if (currentEntryIdx === -1) currentEntryIdx = 0;
    }

    const nextEntryIdx = (currentEntryIdx + 1) % totalEntries;

    if (nextEntryIdx < sourceGroups.length) {
      // Switch to an imagery source (first viz)
      const nextGroup = sourceGroups[nextEntryIdx];
      setSelectedLayerIndex(nextGroup.startIdx);
      // Also switch to that source's collection so the map tiles update
      const targetSource = campaign?.imagery_sources.find((s) => s.name === nextGroup.name);
      if (targetSource && selectedView) {
        const ref = selectedView.collection_refs.find((r) => r.source_id === targetSource.id);
        if (ref) setActiveCollectionId(ref.collection_id);
      }
    } else {
      // Switch to a specific basemap
      const bmIdx = nextEntryIdx - sourceGroups.length;
      setShowBasemap(true);
      setSelectedBasemapId(basemapIds[bmIdx]);
    }
  }, [
    sourceGroups,
    basemapIds,
    selectedLayerIndex,
    selectedBasemapId,
    showBasemap,
    setSelectedLayerIndex,
    setShowBasemap,
    setSelectedBasemapId,
    campaign,
    selectedView,
    setActiveCollectionId,
  ]);

  /** Shift+I: cycle visualizations within the active source (the source owning activeCollectionId) */
  const cycleVisualization = useCallback(() => {
    if (showBasemap || sourceGroups.length === 0 || !campaign) return;
    // Find the source group that owns the active collection
    const activeSrc = campaign.imagery_sources.find((s) =>
      s.collections.some((c) => c.id === activeCollectionId)
    );
    if (!activeSrc) return;
    const activeGroup = sourceGroups.find((g) => g.name === activeSrc.name);
    if (!activeGroup || activeGroup.count <= 1) return;
    // Compute current position within the active source
    const posInGroup = Math.max(0, selectedLayerIndex - activeGroup.startIdx);
    const clampedPos = Math.min(posInGroup, activeGroup.count - 1);
    const nextPos = (clampedPos + 1) % activeGroup.count;
    setSelectedLayerIndex(activeGroup.startIdx + nextPos);
  }, [
    sourceGroups,
    selectedLayerIndex,
    showBasemap,
    setSelectedLayerIndex,
    campaign,
    activeCollectionId,
  ]);

  // Cycle views
  const cycleView = useCallback(() => {
    if (!campaign || campaign.imagery_views.length <= 1) return;
    const views = campaign.imagery_views;
    const currentIdx = views.findIndex((v) => v.id === selectedViewId);
    const nextIdx = (currentIdx + 1) % views.length;
    setSelectedViewId(views[nextIdx].id);
  }, [campaign, selectedViewId, setSelectedViewId]);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting || isNavigating) return;

    // Get current task to check if annotation exists
    const currentTask = visibleTasks[currentTaskIndex] || null;
    const hasExistingAnnotation = currentTask?.annotations && currentTask.annotations.length > 0;

    // Allow submission with null label only if removing an existing annotation
    if (!selectedLabelId && !hasExistingAnnotation) {
      showAlert('Please select a label before submitting', 'error');
      return;
    }

    await submitAnnotation(selectedLabelId, comment, confidence);
    // Don't reset form here - let the effect in AnnotationControls handle it when task changes
  }, [
    isSubmitting,
    isNavigating,
    selectedLabelId,
    comment,
    confidence,
    submitAnnotation,
    showAlert,
    visibleTasks,
    currentTaskIndex,
  ]);

  // Skip handler
  const handleSkip = useCallback(async () => {
    if (isSubmitting || isNavigating) return;

    await submitAnnotation(null, comment, confidence);
    // Don't reset form here - let the effect in AnnotationControls handle it when task changes
  }, [isSubmitting, isNavigating, comment, confidence, submitAnnotation]);

  // Focus comment box
  const focusComment = useCallback(() => {
    const textarea = commentInputRef.current;
    if (!textarea) return;
    textarea.focus();
  }, [commentInputRef]);

  // Adjust confidence level
  const adjustConfidence = useCallback(
    (delta: number) => {
      setConfidence(Math.max(1, Math.min(5, confidence + delta)));
    },
    [confidence, setConfidence]
  );

  // Main keydown handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if submitting
      if (isSubmitting) return;

      // Skip all shortcuts when typing in an input/textarea (including goto task number input)
      const isTyping =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;

      if (isTyping) {
        // Only handle Escape to unfocus when typing
        if (e.key === 'Escape') {
          e.preventDefault();
          (document.activeElement as HTMLElement)?.blur();
        }
        // Allow all other keys to work normally in inputs
        return;
      }

      // Number keys for label selection
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleDigitInput(e.key);
        return;
      }

      switch (e.key) {
        // Task navigation
        case 'w':
        case 'W':
          e.preventDefault();
          if (!isNavigating) previousTask();
          break;
        case 's':
        case 'S':
          e.preventDefault();
          if (!isNavigating) nextTask();
          break;

        // Slice/Collection navigation: A/D for slices, Shift+A/D for collections
        case 'a':
        case 'A':
          e.preventDefault();
          if (e.shiftKey) {
            navigateCollection('prev');
          } else {
            navigateSlice('prev');
          }
          break;
        case 'd':
        case 'D':
          e.preventDefault();
          if (e.shiftKey) {
            navigateCollection('next');
          } else {
            navigateSlice('next');
          }
          break;

        // Map controls
        case ' ':
          e.preventDefault();
          triggerRefocus();
          break;
        case 'o':
        case 'O':
          e.preventDefault();
          toggleCrosshair();
          break;
        case 'v':
        case 'V':
          e.preventDefault();
          cycleView();
          break;

        // Arrow keys: pan by default, zoom with Alt modifier
        case 'ArrowUp':
          e.preventDefault();
          if (e.altKey) {
            triggerZoomIn();
          } else {
            triggerPan('up');
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (e.altKey) {
            triggerZoomOut();
          } else {
            triggerPan('down');
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          triggerPan('left');
          break;
        case 'ArrowRight':
          e.preventDefault();
          triggerPan('right');
          break;

        // Comment focus
        case 'c':
        case 'C':
          e.preventDefault();
          focusComment();
          break;

        // Confidence adjustment
        case 'q':
        case 'Q':
          e.preventDefault();
          adjustConfidence(-1); // Decrease confidence
          break;
        case 'e':
        case 'E':
          e.preventDefault();
          adjustConfidence(1); // Increase confidence
          break;

        // Submit
        case 'Enter':
          e.preventDefault();
          handleSubmit();
          break;

        // Skip
        case 'b':
        case 'B':
          e.preventDefault();
          handleSkip();
          break;

        // Toggle keyboard help
        case 'h':
        case 'H':
          e.preventDefault();
          toggleKeyboardHelp();
          break;

        // Toggle campaign guide
        case 'g':
        case 'G':
          e.preventDefault();
          toggleGuide();
          break;

        // Toggle view sync
        case 'l':
        case 'L':
          e.preventDefault();
          useMapStore.getState().toggleViewSync();
          break;

        // Cycle imagery source / visualization
        case 'i':
        case 'I':
          e.preventDefault();
          if (e.shiftKey) {
            cycleVisualization();
          } else {
            cycleSource();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (digitTimeoutRef.current) {
        clearTimeout(digitTimeoutRef.current);
        digitTimeoutRef.current = null;
      }
      digitBuffer.current = '';
    };
  }, [
    isSubmitting,
    isNavigating,
    commentInputRef,
    handleDigitInput,
    previousTask,
    nextTask,
    navigateSlice,
    navigateCollection,
    triggerRefocus,
    toggleCrosshair,
    triggerZoomIn,
    triggerZoomOut,
    triggerPan,
    focusComment,
    adjustConfidence,
    handleSubmit,
    handleSkip,
    toggleKeyboardHelp,
    toggleGuide,
    cycleSource,
    cycleVisualization,
    cycleView,
  ]);

  // Removed duplicate cleanup useEffect - consolidated above
};
