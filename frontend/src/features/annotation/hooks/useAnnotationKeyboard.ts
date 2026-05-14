import { useEffect, useRef, useCallback, useMemo } from 'react';
import { DIGIT_INPUT_TIMEOUT_MS } from '~/shared/utils/constants';
import { useLayoutStore } from '~/features/layout/layout.store';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';
import { useSliceNavigation } from './useSliceNavigation';

interface UseAnnotationKeyboardOptions {
  commentInputRef: React.RefObject<HTMLTextAreaElement | null>;
}

const SLICE_AUTONAV_INTERVAL_MS = 500;

export const useAnnotationKeyboard = ({ commentInputRef }: UseAnnotationKeyboardOptions) => {
  const digitBuffer = useRef<string>('');
  const digitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sliceAutoNavRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const campaign = useCampaignStore((s) => s.campaign);
  const selectedViewId = useCampaignStore((s) => s.selectedViewId);
  const setSelectedViewId = useCampaignStore((s) => s.setSelectedViewId);

  const selectedLabelId = useTaskStore((s) => s.selectedLabelId);
  const comment = useTaskStore((s) => s.comment);
  const confidence = useTaskStore((s) => s.confidence);
  const flaggedForReview = useTaskStore((s) => s.flaggedForReview);
  const flagComment = useTaskStore((s) => s.flagComment);
  const isSubmitting = useTaskStore((s) => s.isSubmitting);
  const isNavigating = useTaskStore((s) => s.isNavigating);
  const visibleTasks = useTaskStore((s) => s.visibleTasks);
  const currentTaskIndex = useTaskStore((s) => s.currentTaskIndex);
  const nextTask = useTaskStore((s) => s.nextTask);
  const previousTask = useTaskStore((s) => s.previousTask);
  const setSelectedLabelId = useTaskStore((s) => s.setSelectedLabelId);
  const setConfidence = useTaskStore((s) => s.setConfidence);
  const setFlaggedForReview = useTaskStore((s) => s.setFlaggedForReview);
  const submitAnnotation = useTaskStore((s) => s.submitAnnotation);

  const activeCollectionId = useMapStore((s) => s.activeCollectionId);
  const triggerRefocus = useMapStore((s) => s.triggerRefocus);
  const toggleCrosshair = useMapStore((s) => s.toggleCrosshair);
  const triggerZoomIn = useMapStore((s) => s.triggerZoomIn);
  const triggerZoomOut = useMapStore((s) => s.triggerZoomOut);
  const triggerPan = useMapStore((s) => s.triggerPan);
  const selectedLayerIndex = useMapStore((s) => s.selectedLayerIndex);
  const showBasemap = useMapStore((s) => s.showBasemap);
  const setSelectedLayerIndex = useMapStore((s) => s.setSelectedLayerIndex);

  const showAlert = useLayoutStore((s) => s.showAlert);
  const toggleKeyboardHelp = useLayoutStore((s) => s.toggleKeyboardHelp);
  const toggleGuide = useLayoutStore((s) => s.toggleGuide);

  const labels = useMemo(() => campaign?.settings.labels ?? [], [campaign?.settings.labels]);

  // Derive the selected view (still needed for source cycling below)
  const selectedView = campaign?.imagery_views.find((v) => v.id === selectedViewId);

  const { navigateSlice, navigateCollection } = useSliceNavigation();

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

  // Keep refs to the latest nav callbacks so the autoscroll interval reads
  // current state on each tick instead of the stale closures captured when
  // the interval was started.
  const navigateSliceRef = useRef(navigateSlice);
  const navigateCollectionRef = useRef(navigateCollection);
  useEffect(() => {
    navigateSliceRef.current = navigateSlice;
    navigateCollectionRef.current = navigateCollection;
  });

  const stopSliceAutoNav = useCallback(() => {
    if (sliceAutoNavRef.current) {
      clearInterval(sliceAutoNavRef.current);
      sliceAutoNavRef.current = null;
    }
  }, []);

  const startSliceAutoNav = useCallback(
    (direction: 'next' | 'prev', mode: 'slice' | 'collection') => {
      stopSliceAutoNav();
      sliceAutoNavRef.current = setInterval(() => {
        if (mode === 'collection') navigateCollectionRef.current(direction);
        else navigateSliceRef.current(direction);
      }, SLICE_AUTONAV_INTERVAL_MS);
    },
    [stopSliceAutoNav]
  );

  const sourceGroups = useMemo(() => {
    const sources = campaign?.imagery_sources ?? [];
    const viewSourceIds = new Set((selectedView?.collection_refs ?? []).map((r) => r.source_id));
    const groups: { id: number; startIdx: number; count: number }[] = [];
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
  }, [campaign?.imagery_sources, selectedView?.collection_refs]);

  const basemaps = useMemo(() => campaign?.basemaps ?? [], [campaign?.basemaps]);
  const basemapIds = useMemo(() => basemaps.map((b) => `basemap-${b.id}`), [basemaps]);

  const cycleSource = useCallback(() => {
    const sources = campaign?.imagery_sources ?? [];
    if (!selectedView) return;

    const totalEntries = sourceGroups.length + basemapIds.length;
    if (totalEntries <= 1) return;

    const map = useMapStore.getState();
    const { selectedLayerIndex: layerIdx, showBasemap: onBasemap } = map;
    const colId = map.activeCollectionId;

    let currentEntryIdx: number;
    if (onBasemap) {
      const bmIdx = basemapIds.indexOf(map.selectedBasemapId ?? '');
      currentEntryIdx = sourceGroups.length + Math.max(0, bmIdx);
    } else {
      const srcByCollection = sources.find((s) => s.collections.some((c) => c.id === colId));
      currentEntryIdx = srcByCollection
        ? sourceGroups.findIndex((g) => g.id === srcByCollection.id)
        : sourceGroups.findIndex((g) => layerIdx >= g.startIdx && layerIdx < g.startIdx + g.count);
      if (currentEntryIdx === -1) currentEntryIdx = 0;
    }

    if (!onBasemap && colId !== null) {
      const currentSrc = sources.find((s) => s.collections.some((c) => c.id === colId));
      if (currentSrc) map.recordSourceState(currentSrc.id, colId, layerIdx);
    }

    const nextEntryIdx = (currentEntryIdx + 1) % totalEntries;

    if (nextEntryIdx >= sourceGroups.length) {
      const bmIdx = nextEntryIdx - sourceGroups.length;
      map.setShowBasemap(true);
      map.setSelectedBasemapId(basemapIds[bmIdx]);
      return;
    }

    const nextGroup = sourceGroups[nextEntryIdx];
    const targetSource = sources.find((s) => s.id === nextGroup.id);
    if (!targetSource) return;

    map.setSelectedLayerIndex(nextGroup.startIdx);

    const remembered = map.lastSourceState[targetSource.id];
    const canRestore =
      remembered &&
      targetSource.collections.some((c) => c.id === remembered.collectionId) &&
      selectedView.collection_refs.some((r) => r.collection_id === remembered.collectionId);

    const targetCollectionId = canRestore
      ? remembered.collectionId
      : selectedView.collection_refs.find((r) => r.source_id === targetSource.id)?.collection_id;
    if (targetCollectionId !== undefined) map.setActiveCollectionId(targetCollectionId);
  }, [sourceGroups, basemapIds, campaign, selectedView]);

  /** Shift+I: cycle visualizations within the active source (the source owning activeCollectionId) */
  const cycleVisualization = useCallback(() => {
    if (showBasemap || sourceGroups.length === 0 || !campaign) return;
    // Find the source group that owns the active collection
    const activeSrc = campaign.imagery_sources.find((s) =>
      s.collections.some((c) => c.id === activeCollectionId)
    );
    if (!activeSrc) return;
    const activeGroup = sourceGroups.find((g) => g.id === activeSrc.id);
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

    await submitAnnotation(
      selectedLabelId,
      comment,
      confidence,
      undefined,
      flaggedForReview,
      flagComment
    );
    // Don't reset form here - let the effect in AnnotationControls handle it when task changes
  }, [
    isSubmitting,
    isNavigating,
    selectedLabelId,
    comment,
    confidence,
    flaggedForReview,
    flagComment,
    submitAnnotation,
    showAlert,
    visibleTasks,
    currentTaskIndex,
  ]);

  // Skip handler
  const handleSkip = useCallback(async () => {
    if (isSubmitting || isNavigating) return;

    await submitAnnotation(null, comment, confidence, undefined, flaggedForReview, flagComment);
    // Don't reset form here - let the effect in AnnotationControls handle it when task changes
  }, [
    isSubmitting,
    isNavigating,
    comment,
    confidence,
    flaggedForReview,
    flagComment,
    submitAnnotation,
  ]);

  const toggleFlagForReview = useCallback(() => {
    setFlaggedForReview(!flaggedForReview);
  }, [flaggedForReview, setFlaggedForReview]);

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

  const setConfidenceLevel = useCallback(
    (level: number) => {
      if (level >= 1 && level <= 5) setConfidence(level);
    },
    [setConfidence]
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

      // Shift+1..5 sets confidence directly. Use e.code since shifted digit
      // keys produce symbols (!@#$%) in e.key on most layouts.
      if (e.shiftKey && /^Digit[1-5]$/.test(e.code)) {
        e.preventDefault();
        setConfidenceLevel(parseInt(e.code.slice(5), 10));
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

        // Slice/Collection navigation: A/D for slices, Shift+A/D for collections.
        // Holding the key auto-advances at SLICE_AUTONAV_INTERVAL_MS cadence
        // (OS key-repeat would be too fast for time-series scrubbing).
        case 'a':
        case 'A': {
          e.preventDefault();
          if (e.repeat) break;
          const mode = e.shiftKey ? 'collection' : 'slice';
          if (mode === 'collection') navigateCollection('prev');
          else navigateSlice('prev');
          startSliceAutoNav('prev', mode);
          break;
        }
        case 'd':
        case 'D': {
          e.preventDefault();
          if (e.repeat) break;
          const mode = e.shiftKey ? 'collection' : 'slice';
          if (mode === 'collection') navigateCollection('next');
          else navigateSlice('next');
          startSliceAutoNav('next', mode);
          break;
        }

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

        // Flag for review
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFlagForReview();
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

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'a' || e.key === 'A' || e.key === 'd' || e.key === 'D') {
        stopSliceAutoNav();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', stopSliceAutoNav);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', stopSliceAutoNav);
      // Note: don't stop the autoscroll interval here. This effect re-runs on
      // every nav state change (activeSliceIndex updates → navigateSlice gets
      // a new identity → effect re-runs), so clearing it would kill the
      // interval after the first tick. Interval is stopped on keyup/blur, and
      // on unmount via the dedicated effect below.
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
    startSliceAutoNav,
    stopSliceAutoNav,
    triggerRefocus,
    toggleCrosshair,
    triggerZoomIn,
    triggerZoomOut,
    triggerPan,
    focusComment,
    adjustConfidence,
    setConfidenceLevel,
    handleSubmit,
    handleSkip,
    toggleFlagForReview,
    toggleKeyboardHelp,
    toggleGuide,
    cycleSource,
    cycleVisualization,
    cycleView,
  ]);

  // Stop slice autoscroll only on unmount. stopSliceAutoNav has empty deps so
  // this effect's identity is stable and the cleanup only fires on unmount.
  useEffect(() => {
    return () => stopSliceAutoNav();
  }, [stopSliceAutoNav]);
};
