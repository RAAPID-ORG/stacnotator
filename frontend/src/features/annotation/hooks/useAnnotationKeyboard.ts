import { useEffect, useRef, useCallback, useMemo } from 'react';
import { DIGIT_INPUT_TIMEOUT_MS } from '~/shared/utils/constants';
import { useLayoutStore } from '~/features/layout/layout.store';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';
import { computeTimeSlices } from '~/shared/utils/utility';

interface UseAnnotationKeyboardOptions {
  commentInputRef: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * Keyboard shortcuts for the annotation page
 *
 * Navigation:
 * - Arrow Keys: Pan maps (up/down/left/right)
 * - Alt + Arrow Up/Down: Zoom in/out
 * - Space: Recenter maps
 * - O: Toggle crosshair on/off
 * - W: Previous task
 * - S: Next task
 * - A/D: Switch to next/previous imagery slice
 * - Shift+A/D: Switch to next/previous imagery window
 * - C: Focus on comment box
 * - Esc: Unfocus from input fields
 * - Enter: Submit annotation + comment
 * - B: Skip annotation
 * - Number keys: Select label by index (supports multi-digit)
 * - Q/E: Decrease/increase confidence level
 * - H: Hide/show help dialog
 */
export const useAnnotationKeyboard = ({ commentInputRef }: UseAnnotationKeyboardOptions) => {
  const digitBuffer = useRef<string>('');
  const digitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store selectors
  const campaign = useCampaignStore((s) => s.campaign);
  const selectedImageryId = useCampaignStore((s) => s.selectedImageryId);
  const setSelectedImageryId = useCampaignStore((s) => s.setSelectedImageryId);

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

  const activeWindowId = useMapStore((s) => s.activeWindowId);
  const activeSliceIndex = useMapStore((s) => s.activeSliceIndex);
  const triggerRefocus = useMapStore((s) => s.triggerRefocus);
  const toggleCrosshair = useMapStore((s) => s.toggleCrosshair);
  const triggerZoomIn = useMapStore((s) => s.triggerZoomIn);
  const triggerZoomOut = useMapStore((s) => s.triggerZoomOut);
  const triggerPan = useMapStore((s) => s.triggerPan);
  const setActiveWindowId = useMapStore((s) => s.setActiveWindowId);
  const setActiveSliceIndex = useMapStore((s) => s.setActiveSliceIndex);
  const selectedLayerIndex = useMapStore((s) => s.selectedLayerIndex);
  const showBasemap = useMapStore((s) => s.showBasemap);
  const basemapType = useMapStore((s) => s.basemapType);
  const setSelectedLayerIndex = useMapStore((s) => s.setSelectedLayerIndex);
  const setShowBasemap = useMapStore((s) => s.setShowBasemap);
  const setBasemapType = useMapStore((s) => s.setBasemapType);
  const emptySlices = useMapStore((s) => s.emptySlices);
  const windowSliceIndices = useMapStore((s) => s.windowSliceIndices);

  const showAlert = useLayoutStore((s) => s.showAlert);
  const toggleKeyboardHelp = useLayoutStore((s) => s.toggleKeyboardHelp);

  // Derived values
  const selectedImagery = campaign?.imagery.find((img) => img.id === selectedImageryId);
  const labels = useMemo(() => campaign?.settings.labels ?? [], [campaign?.settings.labels]);

  // Sort windows by window_index for proper ordering
  const sortedWindows = useMemo(() => {
    const wins = selectedImagery?.windows ?? [];
    return [...wins].sort((a, b) => (a.window_index ?? 0) - (b.window_index ?? 0));
  }, [selectedImagery?.windows]);

  // Get current window and its position in sorted order
  const currentWindowId = activeWindowId ?? selectedImagery?.default_main_window_id ?? null;
  const currentWindowSortedIndex = sortedWindows.findIndex((w) => w.id === currentWindowId);
  const currentWindow = sortedWindows[currentWindowSortedIndex];

  // Compute slices for the current window using the same utility as the UI
  const slices = useMemo(() => {
    if (!currentWindow || !selectedImagery) return [];
    return computeTimeSlices(
      currentWindow.window_start_date,
      currentWindow.window_end_date,
      selectedImagery.slicing_interval,
      selectedImagery.slicing_unit
    );
  }, [currentWindow, selectedImagery]);

  const currentSliceCount = Math.max(1, slices.length);

  // Helper to get slice count for a window
  const getSliceCountForWindow = useCallback(
    (window: typeof currentWindow) => {
      if (!window || !selectedImagery) return 1;
      const windowSlices = computeTimeSlices(
        window.window_start_date,
        window.window_end_date,
        selectedImagery.slicing_interval,
        selectedImagery.slicing_unit
      );
      return Math.max(1, windowSlices.length);
    },
    [selectedImagery]
  );

  /**
   * Find the first non-empty slice index for a window, searching forward from
   * `startIndex` (wrapping is not needed - just find the first valid one).
   * Returns -1 if all slices are empty.
   */
  const firstNonEmptySlice = useCallback(
    (windowId: number, totalSlices: number, preferredIndex = 0): number => {
      // Try from preferredIndex forward, then from 0
      for (let offset = 0; offset < totalSlices; offset++) {
        const i = (preferredIndex + offset) % totalSlices;
        if (!emptySlices[`${windowId}-${i}`]) return i;
      }
      return -1; // All slices empty
    },
    [emptySlices]
  );

  // Select label by index (1-based)
  const selectLabelByIndex = useCallback(
    (index: number) => {
      if (index > 0 && index <= labels.length) {
        const targetLabelId = labels[index - 1].id;
        // Toggle: deselect if already selected, otherwise select
        setSelectedLabelId(selectedLabelId === targetLabelId ? null : targetLabelId);
      }
    },
    [labels, setSelectedLabelId, selectedLabelId]
  );

  // Process digit buffer
  const processDigitBuffer = useCallback(() => {
    const num = parseInt(digitBuffer.current, 10);
    if (!isNaN(num) && num > 0) {
      selectLabelByIndex(num);
    }
    digitBuffer.current = '';
  }, [selectLabelByIndex]);

  // Handle digit input with smart immediate selection
  const handleDigitInput = useCallback(
    (digit: string) => {
      if (digitTimeoutRef.current) {
        clearTimeout(digitTimeoutRef.current);
        digitTimeoutRef.current = null;
      }

      digitBuffer.current += digit;
      const currentNum = parseInt(digitBuffer.current, 10);

      // Immediate selection conditions:
      // 1. Number already exceeds label count
      // 2. Number * 10 would exceed label count (no valid next digit possible)
      // 3. Already have 2+ digits
      const canAddMoreDigits = currentNum * 10 <= labels.length;

      if (currentNum > labels.length || !canAddMoreDigits || digitBuffer.current.length >= 2) {
        processDigitBuffer();
      } else {
        // Wait briefly for potential second digit
        digitTimeoutRef.current = setTimeout(processDigitBuffer, DIGIT_INPUT_TIMEOUT_MS);
      }
    },
    [labels.length, processDigitBuffer]
  );

  // Navigate slices with window wrap-around when reaching boundaries,
  // automatically skipping slices marked as empty.
  const navigateSlice = useCallback(
    (direction: 'next' | 'prev') => {
      if (!currentWindow) return;

      // Build the ordered list of non-empty slice indices for the current window
      const nonEmpty: number[] = [];
      for (let i = 0; i < currentSliceCount; i++) {
        if (!emptySlices[`${currentWindow.id}-${i}`]) nonEmpty.push(i);
      }

      if (direction === 'next') {
        // Find next non-empty slice after the current index within this window
        const nextInWindow = nonEmpty.find((i) => i > activeSliceIndex);
        if (nextInWindow !== undefined) {
          setActiveSliceIndex(nextInWindow);
        } else if (currentWindowSortedIndex < sortedWindows.length - 1) {
          // Move to next window - land on its first non-empty slice
          const nextWindow = sortedWindows[currentWindowSortedIndex + 1];
          const nextCount = getSliceCountForWindow(nextWindow);
          const landingSlice = firstNonEmptySlice(nextWindow.id, nextCount, 0);
          setActiveWindowId(nextWindow.id);
          if (landingSlice > 0) setTimeout(() => setActiveSliceIndex(landingSlice), 0);
        }
      } else {
        // Find previous non-empty slice before the current index within this window
        const prevInWindow = [...nonEmpty].reverse().find((i) => i < activeSliceIndex);
        if (prevInWindow !== undefined) {
          setActiveSliceIndex(prevInWindow);
        } else if (currentWindowSortedIndex > 0) {
          // Move to previous window - land on its last non-empty slice
          const prevWindow = sortedWindows[currentWindowSortedIndex - 1];
          const prevCount = getSliceCountForWindow(prevWindow);
          // Search backward from the last slice to find last non-empty
          let landingSlice = -1;
          for (let i = prevCount - 1; i >= 0; i--) {
            if (!emptySlices[`${prevWindow.id}-${i}`]) { landingSlice = i; break; }
          }
          if (landingSlice < 0) return; // all empty - don't switch
          setActiveWindowId(prevWindow.id);
          setTimeout(() => setActiveSliceIndex(landingSlice), 0);
        }
      }
    },
    [
      activeSliceIndex,
      currentSliceCount,
      currentWindowSortedIndex,
      currentWindow,
      sortedWindows,
      emptySlices,
      setActiveSliceIndex,
      setActiveWindowId,
      getSliceCountForWindow,
      firstNonEmptySlice,
    ]
  );

  // Navigate windows directly (Shift+A/D), landing on the stored per-window slice
  const navigateWindow = useCallback(
    (direction: 'next' | 'prev') => {
      if (sortedWindows.length === 0) return;

      let targetWindow: typeof currentWindow | undefined;
      if (direction === 'next') {
        if (currentWindowSortedIndex < sortedWindows.length - 1) {
          targetWindow = sortedWindows[currentWindowSortedIndex + 1];
        }
      } else {
        if (currentWindowSortedIndex > 0) {
          targetWindow = sortedWindows[currentWindowSortedIndex - 1];
        }
      }

      if (!targetWindow) return;

      // setActiveWindowId restores from windowSliceIndices[id] ?? 0
      // If that stored slice is empty, override to the nearest non-empty one
      const targetCount = getSliceCountForWindow(targetWindow);
      const storedSlice = windowSliceIndices[targetWindow.id] ?? 0;
      const isStoredEmpty = emptySlices[`${targetWindow.id}-${storedSlice}`];

      setActiveWindowId(targetWindow.id);

      if (isStoredEmpty) {
        const fallback = firstNonEmptySlice(targetWindow.id, targetCount, storedSlice);
        if (fallback >= 0) setTimeout(() => setActiveSliceIndex(fallback), 0);
      }
    },
    [currentWindowSortedIndex, sortedWindows, setActiveWindowId, setActiveSliceIndex, getSliceCountForWindow, firstNonEmptySlice, windowSliceIndices, emptySlices]
  );

  const BASEMAP_TYPES = ['carto-light', 'esri-world-imagery', 'opentopomap'] as const;

  const cycleLayer = useCallback(() => {
    const templates = selectedImagery?.visualization_url_templates ?? [];
    const vizCount = templates.length;
    const basemapCount = BASEMAP_TYPES.length;
    const totalCount = vizCount + basemapCount;
    if (totalCount === 0) return;

    // Compute current position in the flat list: [viz0..vizN-1, basemap0..basemap2]
    let currentPos: number;
    if (showBasemap) {
      const bmIdx = BASEMAP_TYPES.indexOf(basemapType as typeof BASEMAP_TYPES[number]);
      currentPos = vizCount + (bmIdx >= 0 ? bmIdx : 0);
    } else {
      currentPos = selectedLayerIndex;
    }

    const nextPos = (currentPos + 1) % totalCount;

    if (nextPos < vizCount) {
      setSelectedLayerIndex(nextPos); // also sets showBasemap: false
    } else {
      const bmIdx = nextPos - vizCount;
      setBasemapType(BASEMAP_TYPES[bmIdx]);
      setShowBasemap(true);
    }
  }, [selectedImagery, selectedLayerIndex, showBasemap, basemapType, setSelectedLayerIndex, setShowBasemap, setBasemapType]);

  // Cycle through imagery sources
  const cycleImagery = useCallback(() => {
    if (!campaign || campaign.imagery.length <= 1) return;
    const imageryList = campaign.imagery;
    const currentIdx = imageryList.findIndex((img) => img.id === selectedImageryId);
    const nextIdx = (currentIdx + 1) % imageryList.length;
    setSelectedImageryId(imageryList[nextIdx].id);
  }, [campaign, selectedImageryId, setSelectedImageryId]);

  // Submit handler
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

        // Slice/Window navigation: A/D for slices, Shift+A/D for windows
        case 'a':
        case 'A':
          e.preventDefault();
          if (e.shiftKey) {
            navigateWindow('prev');
          } else {
            navigateSlice('prev');
          }
          break;
        case 'd':
        case 'D':
          e.preventDefault();
          if (e.shiftKey) {
            navigateWindow('next');
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

        // Cycle visualization layer
        case 'l':
        case 'L':
          e.preventDefault();
          cycleLayer();
          break;

        // Cycle imagery source
        case 'i':
        case 'I':
          e.preventDefault();
          cycleImagery();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      // Clear any pending digit timeout on cleanup
      if (digitTimeoutRef.current) {
        clearTimeout(digitTimeoutRef.current);
        digitTimeoutRef.current = null;
      }
      // Clear digit buffer on cleanup
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
    navigateWindow,
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
    cycleLayer,
    cycleImagery,
  ]);

  // Removed duplicate cleanup useEffect - consolidated above
};
