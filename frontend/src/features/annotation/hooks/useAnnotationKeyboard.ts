import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useAnnotationStore } from '~/stores/annotationStore';
import { useUIStore } from '~/stores/uiStore';
import { computeTimeSlices } from '~/utils/utility';
import { DIGIT_INPUT_TIMEOUT_MS } from '~/shared/utils/constants';

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
 * - H: Hide/show help dialog
 */
export const useAnnotationKeyboard = ({ commentInputRef }: UseAnnotationKeyboardOptions) => {
  const digitBuffer = useRef<string>('');
  const digitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store selectors
  const campaign = useAnnotationStore((state) => state.campaign);
  const selectedImageryId = useAnnotationStore((state) => state.selectedImageryId);
  const activeWindowId = useAnnotationStore((state) => state.activeWindowId);
  const activeSliceIndex = useAnnotationStore((state) => state.activeSliceIndex);
  const selectedLabelId = useAnnotationStore((state) => state.selectedLabelId);
  const comment = useAnnotationStore((state) => state.comment);
  const isSubmitting = useAnnotationStore((state) => state.isSubmitting);
  const isNavigating = useAnnotationStore((state) => state.isNavigating);
  const visibleTasks = useAnnotationStore((state) => state.visibleTasks);
  const currentTaskIndex = useAnnotationStore((state) => state.currentTaskIndex);

  // Store actions
  const nextTask = useAnnotationStore((state) => state.nextTask);
  const previousTask = useAnnotationStore((state) => state.previousTask);
  const triggerRefocus = useAnnotationStore((state) => state.triggerRefocus);
  const toggleCrosshair = useAnnotationStore((state) => state.toggleCrosshair);
  const triggerZoomIn = useAnnotationStore((state) => state.triggerZoomIn);
  const triggerZoomOut = useAnnotationStore((state) => state.triggerZoomOut);
  const triggerPan = useAnnotationStore((state) => state.triggerPan);
  const setActiveWindowId = useAnnotationStore((state) => state.setActiveWindowId);
  const setActiveSliceIndex = useAnnotationStore((state) => state.setActiveSliceIndex);
  const setSelectedLabelId = useAnnotationStore((state) => state.setSelectedLabelId);
  const submitAnnotation = useAnnotationStore((state) => state.submitAnnotation);
  const resetAnnotationForm = useAnnotationStore((state) => state.resetAnnotationForm);
  const showAlert = useUIStore((state) => state.showAlert);
  const toggleKeyboardHelp = useUIStore((state) => state.toggleKeyboardHelp);

  // Derived values
  const selectedImagery = campaign?.imagery.find((img) => img.id === selectedImageryId);
  const labels = campaign?.settings.labels ?? [];

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

  // Navigate slices with window wrap-around when reaching boundaries
  const navigateSlice = useCallback(
    (direction: 'next' | 'prev') => {
      if (direction === 'next') {
        if (activeSliceIndex < currentSliceCount - 1) {
          // Move to next slice within current window
          setActiveSliceIndex(activeSliceIndex + 1);
        } else if (currentWindowSortedIndex < sortedWindows.length - 1) {
          // At last slice, move to next window (first slice)
          setActiveWindowId(sortedWindows[currentWindowSortedIndex + 1].id);
          // setActiveWindowId resets slice to 0 automatically
        }
      } else {
        if (activeSliceIndex > 0) {
          // Move to previous slice within current window
          setActiveSliceIndex(activeSliceIndex - 1);
        } else if (currentWindowSortedIndex > 0) {
          // At first slice, move to previous window (last slice)
          const prevWindow = sortedWindows[currentWindowSortedIndex - 1];
          const prevWindowSliceCount = getSliceCountForWindow(prevWindow);
          setActiveWindowId(prevWindow.id);
          // Need to set slice after window change
          setTimeout(() => setActiveSliceIndex(prevWindowSliceCount - 1), 0);
        }
      }
    },
    [
      activeSliceIndex,
      currentSliceCount,
      currentWindowSortedIndex,
      sortedWindows,
      setActiveSliceIndex,
      setActiveWindowId,
      getSliceCountForWindow,
    ]
  );

  // Navigate windows directly (Shift+W/S)
  const navigateWindow = useCallback(
    (direction: 'next' | 'prev') => {
      if (sortedWindows.length === 0) return;

      if (direction === 'next') {
        if (currentWindowSortedIndex < sortedWindows.length - 1) {
          setActiveWindowId(sortedWindows[currentWindowSortedIndex + 1].id);
        }
      } else {
        if (currentWindowSortedIndex > 0) {
          setActiveWindowId(sortedWindows[currentWindowSortedIndex - 1].id);
        }
      }
    },
    [currentWindowSortedIndex, sortedWindows, setActiveWindowId]
  );

  // Submit handler
  const handleSubmit = useCallback(async () => {
    if (isSubmitting || isNavigating) return;

    // Get current task to check if annotation exists
    const currentTask = visibleTasks[currentTaskIndex] || null;
    const hasExistingAnnotation = currentTask?.annotation !== null;

    // Allow submission with null label only if removing an existing annotation
    if (!selectedLabelId && !hasExistingAnnotation) {
      showAlert('Please select a label before submitting', 'error');
      return;
    }

    await submitAnnotation(selectedLabelId, comment);
    // Don't reset form here - let the effect in AnnotationControls handle it when task changes
  }, [
    isSubmitting,
    isNavigating,
    selectedLabelId,
    comment,
    submitAnnotation,
    showAlert,
    visibleTasks,
    currentTaskIndex,
  ]);

  // Skip handler
  const handleSkip = useCallback(async () => {
    if (isSubmitting || isNavigating) return;

    await submitAnnotation(null, comment);
    // Don't reset form here - let the effect in AnnotationControls handle it when task changes
  }, [isSubmitting, isNavigating, comment, submitAnnotation]);

  // Focus comment box
  const focusComment = useCallback(() => {
    const textarea = commentInputRef.current;
    if (!textarea) return;
    textarea.focus();
  }, [commentInputRef]);

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
    handleSubmit,
    handleSkip,
    toggleKeyboardHelp,
  ]);

  // Removed duplicate cleanup useEffect - consolidated above
};
