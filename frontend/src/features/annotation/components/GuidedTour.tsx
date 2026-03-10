import { useState, useEffect, useCallback, useRef } from 'react';
import useAnnotationStore from '../annotation.store';

interface TourStep {
  /** CSS selector for the element to highlight (data-tour="...") */
  target: string;
  /** Step title */
  title: string;
  /** Rich description (JSX allowed) */
  content: React.ReactNode;
  /** Optional placement: top | bottom | left | right */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /**
   * When set, the step becomes interactive: the user must press this key
   * (or one of these keys) before the "Next" button appears.
   */
  requiredKeys?: string[];
  /** Friendly label for the hotkey(s) the user must press */
  requiredKeyLabel?: string;
  /** Number of times the user must press the required key (default 1) */
  requiredPressCount?: number;
  /** Whether to scroll the target into view (default true) */
  scrollIntoView?: boolean;
}


const buildTourSteps = (campaignMode: 'tasks' | 'open'): TourStep[] => {
  if (campaignMode === 'open') {
    return buildOpenModeSteps();
  }
  return buildTaskModeSteps();
};

const buildTaskModeSteps = (): TourStep[] => [
  // Welcome
  {
    target: '[data-tour="toolbar"]',
    title: 'Welcome to STACNotator!',
    content: (
      <p>
        This guided tour will walk you through all the key features of the
        annotation workspace. Almost every action has a keyboard shortcut,
        making your workflow fast and seamless.
      </p>
    ),
    placement: 'bottom',
  },

  // Imagery selector
  {
    target: '[data-tour="imagery-selector"]',
    title: 'Imagery Source',
    content: (
      <p>
        Use this dropdown to switch between the different imagery sources
        configured for this campaign. Each source may have its own time-windows,
        slices, and visualization layers.
      </p>
    ),
    placement: 'bottom',
  },

  // Task filter
  {
    target: '[data-tour="task-filter"]',
    title: 'Task Filter',
    content: (
      <p>
        Filter which tasks are visible - by assignee, status, or a combination.
        Useful when you want to focus on &quot;pending&quot; tasks or review a
        specific user&apos;s work.
      </p>
    ),
    placement: 'bottom',
  },

  // Main map window
  {
    target: '[data-tour="main-map"]',
    title: 'Main Map Window',
    content: (
      <p>
        This is the primary map view. It shows the selected imagery at the
        current window &amp; slice. Use your mouse to pan and scroll to zoom, or
        try the keyboard shortcuts you&apos;ll learn next.
      </p>
    ),
    placement: 'right',
  },

  // Timeline sidebar
  {
    target: '[data-tour="timeline-sidebar"]',
    title: 'Timeline Sidebar',
    content: (
      <p>
        The vertical timeline shows all <strong>windows</strong> in
        chronological order. The highlighted segment is the active window.
        Click or drag along the timeline to quickly jump to a different window.
        Dots inside the active segment represent <strong>slices</strong>.
      </p>
    ),
    placement: 'right',
  },

  // Windows vs Slices explainer
  {
    target: '[data-tour="timeline-sidebar"]',
    title: 'Windows vs Slices',
    content: (
      <div className="space-y-2">
        <p>
          A <strong>Window</strong> is a broad time range (e.g. a year or
          season). A <strong>Slice</strong> is a finer subdivision inside that
          window (e.g. individual months).
        </p>
        <p>
          The main map always shows one slice at a time. The smaller imagery
          panels (below) show the <em>same</em> slice but for <em>different</em>{' '}
          windows so you can compare across time.
        </p>
      </div>
    ),
    placement: 'right',
  },

  // Practice: navigate slices
  {
    target: '[data-tour="main-map"]',
    title: 'Practice: Navigate Slices',
    content: (
      <div className="space-y-2">
        <p>
          Press <kbd className="tour-kbd">A</kbd> to go to the <strong>previous slice</strong> and{' '}
          <kbd className="tour-kbd">D</kbd> to go to the <strong>next slice</strong>.
        </p>
        <p className="text-sm text-neutral-500 italic">
          Try pressing A or D twice now to move through the slices.
        </p>
      </div>
    ),
    placement: 'bottom',
    requiredKeys: ['d', 'a'],
    requiredKeyLabel: 'A or D',
    requiredPressCount: 2,
  },

  // Practice: navigate windows (both directions)
  {
    target: '[data-tour="timeline-sidebar"]',
    title: 'Practice: Navigate Windows',
    content: (
      <div className="space-y-2">
        <p>
          Press <kbd className="tour-kbd">Shift+D</kbd> to go to the <strong>next window</strong> and{' '}
          <kbd className="tour-kbd">Shift+A</kbd> to go to the <strong>previous window</strong>.
        </p>
        <p className="text-sm text-neutral-500 italic">
          Try pressing Shift+D and then Shift+A to navigate both directions.
        </p>
      </div>
    ),
    placement: 'right',
    requiredKeys: ['shift+d', 'shift+a'],
    requiredKeyLabel: 'Shift+A or Shift+D',
    requiredPressCount: 2,
  },

  // Tip: hold to cycle windows
  {
    target: '[data-tour="timeline-sidebar"]',
    title: 'Tip: Hold to Cycle',
    content: (
      <div className="space-y-2">
        <p>
          You can <strong>hold</strong>{' '}
          <kbd className="tour-kbd">A</kbd> / <kbd className="tour-kbd">D</kbd> or{' '}
          <kbd className="tour-kbd">Shift+A</kbd> / <kbd className="tour-kbd">Shift+D</kbd>{' '}
          to smoothly cycle through slices or windows without releasing the
          key. This is great for spotting changes across time in a flickering
          animation style.
        </p>
        <p className="text-sm text-neutral-500 italic">
          Try holding Shift+D for a moment to see it in action.
        </p>
      </div>
    ),
    placement: 'right',
  },

  // Map controls
  {
    target: '[data-tour="map-controls"]',
    title: 'Map Controls',
    content: (
      <div className="space-y-2">
        <p>These buttons control the map display:</p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><strong>Window selector</strong> - choose a window directly</li>
          <li><strong>Slice selector</strong> - choose a slice directly</li>
          <li><strong>Recenter</strong> - snap back to the task location (Space)</li>
          <li><strong>Crosshair</strong> - toggle the crosshair overlay (O)</li>
          <li><strong>Timeseries probe</strong> - click map to inspect time series</li>
        </ul>
      </div>
    ),
    placement: 'left',
  },

  // Practice: recenter
  {
    target: '[data-tour="main-map"]',
    title: 'Practice: Recenter Map',
    content: (
      <div className="space-y-2">
        <p>
          Press <kbd className="tour-kbd">Space</kbd> to recenter the map on the
          current task location.
        </p>
        <p className="text-sm text-neutral-500 italic">
          Try pressing Space now.
        </p>
      </div>
    ),
    placement: 'bottom',
    requiredKeys: [' '],
    requiredKeyLabel: 'Space',
  },

  // Practice: toggle crosshair
  {
    target: '[data-tour="main-map"]',
    title: 'Practice: Toggle Crosshair',
    content: (
      <div className="space-y-2">
        <p>
          Press <kbd className="tour-kbd">O</kbd> to toggle the crosshair
          overlay on the map.
        </p>
        <p className="text-sm text-neutral-500 italic">
          Try pressing O now.
        </p>
      </div>
    ),
    placement: 'bottom',
    requiredKeys: ['o'],
    requiredKeyLabel: 'O',
  },

  // Imagery windows
  {
    target: '[data-tour="imagery-windows"]',
    title: 'Imagery Windows',
    content: (
      <div className="space-y-2">
        <p>
          These smaller panels each show a <strong>different window</strong> at
          the same geographic location. Click a panel&apos;s header to make it the{' '}
          <strong>active window</strong> in the main map.
        </p>
        <p>
          This lets you quickly compare how a location looks across different
          time periods.
        </p>
      </div>
    ),
    placement: 'top',
  },

  // Timeseries chart
  {
    target: '[data-tour="timeseries"]',
    title: 'Time Series Chart',
    content: (
      <div className="space-y-2">
        <p>
          The time series chart shows spectral indices (e.g. NDVI) for the task
          location over time. Vertical bars indicate the currently selected
          window/slice.
        </p>
        <p>
          Use the <strong>timeseries probe</strong> tool in the map controls to
          click anywhere on the map and see its time series.
        </p>
      </div>
    ),
    placement: 'left',
  },

  // Minimap
  {
    target: '[data-tour="minimap"]',
    title: 'Minimap',
    content: (
      <p>
        The minimap gives you a bird&apos;s-eye overview of the campaign area.
        The marker shows the current task location. Coordinates are shown
        in the header - click the copy icon to grab them or hit the link to open in Google Earth.
      </p>
    ),
    placement: 'left',
  },

  // Controls panel
  {
    target: '[data-tour="controls"]',
    title: 'Annotation Controls',
    content: (
      <div className="space-y-2">
        <p>This panel is where you actually annotate:</p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Select a <strong>label</strong> (or press number keys 1-9)</li>
          <li>Optionally add a <strong>comment</strong> (press C to focus)</li>
          <li>Set your <strong>confidence</strong> level (Q/E to adjust)</li>
          <li>Press <strong>Enter</strong> to submit, <strong>B</strong> to skip</li>
        </ul>
      </div>
    ),
    placement: 'left',
  },

  // Practice: navigate tasks
  {
    target: '[data-tour="controls"]',
    title: 'Practice: Navigate Tasks',
    content: (
      <div className="space-y-2">
        <p>
          Press <kbd className="tour-kbd">W</kbd> for the <strong>previous task</strong> and{' '}
          <kbd className="tour-kbd">S</kbd> for the <strong>next task</strong>.
        </p>
        <p className="text-sm text-neutral-500 italic">
          Try pressing S now to move to the next task.
        </p>
      </div>
    ),
    placement: 'left',
    requiredKeys: ['s', 'w'],
    requiredKeyLabel: 'W or S',
    requiredPressCount: 1,
  },

  // Practice: zoom
  {
    target: '[data-tour="main-map"]',
    title: 'Practice: Zoom',
    content: (
      <div className="space-y-2">
        <p>
          Press <kbd className="tour-kbd">Alt+↑</kbd> to <strong>zoom in</strong> and{' '}
          <kbd className="tour-kbd">Alt+↓</kbd> to <strong>zoom out</strong>.
          You can also scroll with the mouse wheel.
        </p>
        <p className="text-sm text-neutral-500 italic">
          Try pressing Alt+↑ now to zoom in.
        </p>
      </div>
    ),
    placement: 'bottom',
    requiredKeys: ['alt+arrowup', 'alt+arrowdown'],
    requiredKeyLabel: 'Alt+↑ or Alt+↓',
    requiredPressCount: 1,
  },

  // Layer cycling
  {
    target: '[data-tour="map-controls"]',
    title: 'Layer & Imagery Cycling',
    content: (
      <div className="space-y-2">
        <p>
          Press <kbd className="tour-kbd">L</kbd> to cycle through available
          visualization layers (e.g. True Color, NDVI, basemaps, etc.).
        </p>
        <p>
          Press <kbd className="tour-kbd">I</kbd> to cycle through imagery
          sources configured for this campaign.
        </p>
        <p>
          You can also use the dropdowns in the toolbar and map controls.
        </p>
      </div>
    ),
    placement: 'left',
  },

  // Review mode
  {
    target: '[data-tour="review-toggle"]',
    title: 'Review Mode',
    content: (
      <div className="space-y-2">
        <p>
          STACNotator has two ways to review annotations:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>Review toggle</strong> (eye icon) - enables review mode
            directly on this annotation page. You&apos;ll see all annotators&apos;
            labels for each task in the controls panel, and authoritative
            reviewers can submit a final label.
          </li>
          <li>
            <strong>Review list</strong> (list icon) - navigates to a
            dedicated review page with a table overview of all annotations,
            agreement statistics, and filtering options.
          </li>
        </ul>
      </div>
    ),
    placement: 'bottom',
  },

  // Edit Layout
  {
    target: '[data-tour="layout-controls"]',
    title: 'Layout Controls',
    content: (
      <p>
        Click <strong>Edit Layout</strong> to drag and resize all the panels to
        your liking. Save as a personal or default layout for the campaign.
        Use the fullscreen button to maximize the annotation workspace.
      </p>
    ),
    placement: 'bottom',
  },

  // Keyboard help
  {
    target: '[data-tour="keyboard-help"]',
    title: 'Keyboard Help',
    content: (
      <div className="space-y-2">
        <p>
          Press <kbd className="tour-kbd">H</kbd> at any time to see the full
          keyboard shortcuts reference. You can also click this button.
        </p>
        <p className="text-sm text-neutral-500 italic">
          Try pressing H now.
        </p>
      </div>
    ),
    placement: 'bottom',
    requiredKeys: ['h'],
    requiredKeyLabel: 'H',
  },

  // Finish
  {
    target: '[data-tour="toolbar"]',
    title: 'Tour Complete',
    content: (
      <div className="space-y-2">
        <p>
          You&apos;re all set! STACNotator is designed to be <strong>keyboard-first</strong> -
          nearly every action has a shortcut, so you can annotate efficiently
          without ever reaching for the mouse. Here&apos;s your cheat-sheet:
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mt-2">
          <span className="text-neutral-600">Navigate tasks</span>
          <kbd className="tour-kbd text-center">W / S</kbd>
          <span className="text-neutral-600">Navigate slices</span>
          <kbd className="tour-kbd text-center">A / D</kbd>
          <span className="text-neutral-600">Navigate windows</span>
          <kbd className="tour-kbd text-center">Shift+A / D</kbd>
          <span className="text-neutral-600">Zoom in/out</span>
          <kbd className="tour-kbd text-center">Alt+↑ / ↓</kbd>
          <span className="text-neutral-600">Recenter</span>
          <kbd className="tour-kbd text-center">Space</kbd>
          <span className="text-neutral-600">Toggle crosshair</span>
          <kbd className="tour-kbd text-center">O</kbd>
          <span className="text-neutral-600">Cycle layers</span>
          <kbd className="tour-kbd text-center">L</kbd>
          <span className="text-neutral-600">Cycle imagery</span>
          <kbd className="tour-kbd text-center">I</kbd>
          <span className="text-neutral-600">Select label</span>
          <kbd className="tour-kbd text-center">1-9</kbd>
          <span className="text-neutral-600">Confidence</span>
          <kbd className="tour-kbd text-center">Q / E</kbd>
          <span className="text-neutral-600">Comment</span>
          <kbd className="tour-kbd text-center">C</kbd>
          <span className="text-neutral-600">Submit</span>
          <kbd className="tour-kbd text-center">Enter</kbd>
          <span className="text-neutral-600">Skip</span>
          <kbd className="tour-kbd text-center">B</kbd>
          <span className="text-neutral-600">Help</span>
          <kbd className="tour-kbd text-center">H</kbd>
        </div>
        <p className="text-sm text-neutral-500 mt-2">
          Press <kbd className="tour-kbd">H</kbd> anytime for the full reference.
          You can restart this tour from the toolbar.
        </p>
      </div>
    ),
    placement: 'bottom',
  },
];

const buildOpenModeSteps = (): TourStep[] => [
  // Welcome
  {
    target: '[data-tour="toolbar"]',
    title: 'Welcome to Open Mode!',
    content: (
      <p>
        In open mode you draw annotations directly on the map. This tour
        will guide you through the key features. Like task mode, almost every
        action has a keyboard shortcut.
      </p>
    ),
    placement: 'bottom',
  },

  // Imagery selector
  {
    target: '[data-tour="imagery-selector"]',
    title: 'Imagery Source',
    content: (
      <p>Switch between configured imagery sources here.</p>
    ),
    placement: 'bottom',
  },

  // Main map
  {
    target: '[data-tour="main-map"]',
    title: 'Main Map',
    content: (
      <p>
        This is your drawing canvas. Use the tools (<kbd className="tour-kbd">V</kbd>,{' '}
        <kbd className="tour-kbd">R</kbd>, <kbd className="tour-kbd">E</kbd>,{' '}
        <kbd className="tour-kbd">T</kbd>) to pan, annotate, edit features, or
        probe time series.
      </p>
    ),
    placement: 'right',
  },

  // Annotation controls
  {
    target: '[data-tour="controls"]',
    title: 'Annotation Controls',
    content: (
      <div className="space-y-2">
        <p>
          Select a label, choose your drawing tool, and toggle magic-wand
          segmentation here.
        </p>
        <p>
          Press number keys <kbd className="tour-kbd">1-9</kbd> to quickly
          select a label and switch to the annotate tool.
        </p>
      </div>
    ),
    placement: 'left',
  },

  // Practice: tool switching
  {
    target: '[data-tour="main-map"]',
    title: 'Practice: Tool Switching',
    content: (
      <div className="space-y-2">
        <p>
          <kbd className="tour-kbd">V</kbd> = Pan &nbsp;
          <kbd className="tour-kbd">R</kbd> = Annotate &nbsp;
          <kbd className="tour-kbd">E</kbd> = Edit &nbsp;
          <kbd className="tour-kbd">T</kbd> = Timeseries
        </p>
        <p className="text-sm text-neutral-500 italic">Try pressing V or R now.</p>
      </div>
    ),
    placement: 'bottom',
    requiredKeys: ['v', 'r', 'e', 't'],
    requiredKeyLabel: 'V, R, E, or T',
  },

  // Practice: navigate slices
  {
    target: '[data-tour="main-map"]',
    title: 'Practice: Navigate Slices',
    content: (
      <div className="space-y-2">
        <p>
          Press <kbd className="tour-kbd">A</kbd> / <kbd className="tour-kbd">D</kbd> to
          navigate between slices, and <kbd className="tour-kbd">Shift+A</kbd> /{' '}
          <kbd className="tour-kbd">Shift+D</kbd> to navigate between windows.
        </p>
        <p className="text-sm text-neutral-500 italic">
          Try pressing D now.
        </p>
      </div>
    ),
    placement: 'bottom',
    requiredKeys: ['d', 'a'],
    requiredKeyLabel: 'A or D',
    requiredPressCount: 1,
  },

  // Practice: fit view
  {
    target: '[data-tour="main-map"]',
    title: 'Practice: Fit View',
    content: (
      <div className="space-y-2">
        <p>
          Press <kbd className="tour-kbd">Space</kbd> to fit the view to all
          your annotations.
        </p>
      </div>
    ),
    placement: 'bottom',
    requiredKeys: [' '],
    requiredKeyLabel: 'Space',
  },

  // Finish
  {
    target: '[data-tour="toolbar"]',
    title: 'Tour Complete',
    content: (
      <div className="space-y-2">
        <p>
          You&apos;re ready to start annotating in open mode! STACNotator is
          designed to be <strong>keyboard-first</strong> - here&apos;s your
          cheat-sheet:
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mt-2">
          <span className="text-neutral-600">Pan tool</span>
          <kbd className="tour-kbd text-center">V</kbd>
          <span className="text-neutral-600">Annotate tool</span>
          <kbd className="tour-kbd text-center">R</kbd>
          <span className="text-neutral-600">Edit tool</span>
          <kbd className="tour-kbd text-center">E</kbd>
          <span className="text-neutral-600">Timeseries tool</span>
          <kbd className="tour-kbd text-center">T</kbd>
          <span className="text-neutral-600">Navigate slices</span>
          <kbd className="tour-kbd text-center">A / D</kbd>
          <span className="text-neutral-600">Navigate windows</span>
          <kbd className="tour-kbd text-center">Shift+A / D</kbd>
          <span className="text-neutral-600">Zoom in/out</span>
          <kbd className="tour-kbd text-center">Alt+↑ / ↓</kbd>
          <span className="text-neutral-600">Fit view</span>
          <kbd className="tour-kbd text-center">Space</kbd>
          <span className="text-neutral-600">Select label</span>
          <kbd className="tour-kbd text-center">1-9</kbd>
          <span className="text-neutral-600">Move feature</span>
          <kbd className="tour-kbd text-center">Alt+drag</kbd>
          <span className="text-neutral-600">Cancel edit</span>
          <kbd className="tour-kbd text-center">Esc</kbd>
          <span className="text-neutral-600">Cycle layers</span>
          <kbd className="tour-kbd text-center">L</kbd>
          <span className="text-neutral-600">Cycle imagery</span>
          <kbd className="tour-kbd text-center">I</kbd>
          <span className="text-neutral-600">Help</span>
          <kbd className="tour-kbd text-center">H</kbd>
        </div>
        <p className="text-sm text-neutral-500 mt-2">
          Press <kbd className="tour-kbd">H</kbd> anytime for the full reference.
          You can restart this tour from the toolbar.
        </p>
      </div>
    ),
    placement: 'bottom',
  },
];


interface GuidedTourProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GuidedTour = ({ isOpen, onClose }: GuidedTourProps) => {
  const campaign = useAnnotationStore((state) => state.campaign);
  const [currentStep, setCurrentStep] = useState(0);
  const [pressCount, setPressCount] = useState(0);
  const [keyFulfilled, setKeyFulfilled] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const mode = (campaign?.mode ?? 'tasks') as 'tasks' | 'open';
  const steps = buildTourSteps(mode);
  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  // Reset key tracking when step changes
  useEffect(() => {
    setPressCount(0);
    setKeyFulfilled(false);
  }, [currentStep]);

  // Keep step data in a ref so the keydown handler is stable
  const stepRef = useRef(step);
  stepRef.current = step;

  // Listen for required key presses
  useEffect(() => {
    if (!isOpen || !step?.requiredKeys || keyFulfilled) return;

    const required = step.requiredPressCount ?? 1;

    const handler = (e: KeyboardEvent) => {
      // Ignore key-repeat events so holding a key doesn't spam the counter
      if (e.repeat) return;

      // Ignore if typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const currentStep = stepRef.current;
      if (!currentStep?.requiredKeys) return;

      // Build the key identifier to match against requiredKeys
      const parts: string[] = [];
      if (e.shiftKey) parts.push('shift');
      if (e.altKey) parts.push('alt');
      if (e.ctrlKey) parts.push('ctrl');
      parts.push(e.key.toLowerCase());
      const combo = parts.join('+');

      // Also check just the plain key for simple keys
      const plainKey = e.key.toLowerCase();

      const matched = currentStep.requiredKeys.some(
        (k) => k.toLowerCase() === combo || k.toLowerCase() === plainKey
      );

      if (matched) {
        setPressCount((prev) => {
          const next = prev + 1;
          if (next >= required) {
            setKeyFulfilled(true);
          }
          return next;
        });
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentStep, keyFulfilled]);

  // Position tooltip relative to the highlighted element
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);

  const positionTooltip = useCallback(() => {
    if (!step) return;

    const el = document.querySelector(step.target);
    if (!el) {
      // Element not found - show centered
      setHighlightRect(null);
      setTooltipStyle({
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      });
      return;
    }

    const rect = el.getBoundingClientRect();
    setHighlightRect(rect);

    const placement = step.placement ?? 'bottom';
    const tooltipEl = tooltipRef.current;
    const tooltipWidth = tooltipEl?.offsetWidth ?? 380;
    const tooltipHeight = tooltipEl?.offsetHeight ?? 200;
    const GAP = 16;

    let top = 0;
    let left = 0;

    switch (placement) {
      case 'bottom':
        top = rect.bottom + GAP;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
      case 'top':
        top = rect.top - tooltipHeight - GAP;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
        left = rect.left - tooltipWidth - GAP;
        break;
      case 'right':
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
        left = rect.right + GAP;
        break;
    }

    // Clamp to viewport
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (left < 12) left = 12;
    if (left + tooltipWidth > vw - 12) left = vw - tooltipWidth - 12;
    if (top < 12) top = 12;
    if (top + tooltipHeight > vh - 12) top = vh - tooltipHeight - 12;

    setTooltipStyle({
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
    });
  }, [step]);

  // Reposition on step change and window resize
  useEffect(() => {
    if (!isOpen) return;

    // Small delay to let DOM update after step change
    const timer = setTimeout(positionTooltip, 80);

    const handleResize = () => positionTooltip();
    window.addEventListener('resize', handleResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, currentStep, positionTooltip, keyFulfilled]);

  // Scroll target into view
  useEffect(() => {
    if (!isOpen || !step || step.scrollIntoView === false) return;
    const el = document.querySelector(step.target);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [isOpen, step, currentStep]);

  const handleNext = useCallback(() => {
    if (isLastStep) {
      onClose();
    } else {
      setCurrentStep((s) => s + 1);
    }
  }, [isLastStep, onClose]);

  const handlePrev = useCallback(() => {
    setCurrentStep((s) => Math.max(0, s - 1));
  }, []);

  const handleSkip = useCallback(() => {
    onClose();
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [isOpen, onClose]);

  if (!isOpen || !step) return null;

  const needsKeyPress = !!step.requiredKeys && !keyFulfilled;
  const requiredTotal = step.requiredPressCount ?? 1;
  const progressPct = Math.round(((currentStep + 1) / steps.length) * 100);

  return (
    <>
      {/* Overlay with spotlight cutout */}
      <div
        ref={overlayRef}
        className="fixed inset-0 z-[10000] pointer-events-auto"
        style={{ isolation: 'isolate' }}
      >
        {/* Semi-transparent backdrop */}
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'auto' }}>
          <defs>
            <mask id="tour-spotlight-mask">
              <rect width="100%" height="100%" fill="white" />
              {highlightRect && (
                <rect
                  x={highlightRect.left - 6}
                  y={highlightRect.top - 6}
                  width={highlightRect.width + 12}
                  height={highlightRect.height + 12}
                  rx="8"
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(0,0,0,0.55)"
            mask="url(#tour-spotlight-mask)"
          />
        </svg>

        {/* Highlight ring around the target element */}
        {highlightRect && (
          <div
            className="absolute border-2 border-brand-400 rounded-lg pointer-events-none animate-pulse"
            style={{
              left: highlightRect.left - 6,
              top: highlightRect.top - 6,
              width: highlightRect.width + 12,
              height: highlightRect.height + 12,
              boxShadow: '0 0 0 4px rgba(65,120,93,0.2)',
            }}
          />
        )}

        {/* Tooltip */}
        <div
          ref={tooltipRef}
          className="tour-tooltip"
          style={tooltipStyle}
        >
          {/* Progress bar */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-neutral-200 rounded-t-xl overflow-hidden">
            <div
              className="h-full bg-brand-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Step counter */}
          <div className="flex items-center justify-between mb-2 pt-1">
            <span className="text-[10px] text-neutral-500 font-medium uppercase tracking-wide">
              Step {currentStep + 1} of {steps.length}
            </span>
            <button
              onClick={handleSkip}
              className="text-neutral-400 hover:text-neutral-600 transition-colors"
              title="Close tour (Esc)"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>

          {/* Title */}
          <h3 className="text-base font-bold text-neutral-900 mb-2">{step.title}</h3>

          {/* Content */}
          <div className="text-sm text-neutral-700 leading-relaxed">{step.content}</div>

          {/* Interactive key press indicator */}
          {step.requiredKeys && (
            <div className="mt-3 p-2.5 rounded-lg bg-neutral-50 border border-neutral-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-neutral-600">
                  {keyFulfilled ? (
                    <span className="text-brand-600 flex items-center gap-1">
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Done! Click Next to continue.
                    </span>
                  ) : (
                    <>
                      Press <kbd className="tour-kbd">{step.requiredKeyLabel}</kbd>
                      {requiredTotal > 1 && (
                        <span className="ml-1 text-neutral-400">
                          ({pressCount}/{requiredTotal})
                        </span>
                      )}
                    </>
                  )}
                </span>
                {!keyFulfilled && (
                  <div className="flex gap-0.5">
                    {Array.from({ length: requiredTotal }).map((_, i) => (
                      <div
                        key={i}
                        className={`w-2 h-2 rounded-full transition-colors ${
                          i < pressCount ? 'bg-brand-500' : 'bg-neutral-300'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-4">
            <button
              onClick={handlePrev}
              disabled={currentStep === 0}
              className="px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← Back
            </button>
            <div className="flex gap-2">
              {!isLastStep && (
                <button
                  onClick={handleSkip}
                  className="px-3 py-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-700 transition-colors"
                >
                  Skip Tour
                </button>
              )}
              <button
                onClick={handleNext}
                disabled={needsKeyPress}
                className="px-4 py-1.5 text-xs font-bold bg-brand-500 text-white rounded-md hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isLastStep ? 'Finish' : 'Next →'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
