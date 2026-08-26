import type { TourStep, TourVariant } from './engine';

export interface TourConfig {
  hasTimeseries: boolean;
  /** The campaign asks extra questions per annotation, so the tour has to
   *  explain when they appear and what happens if they go unanswered. */
  hasFormFields: boolean;
}

const toolbar = { kind: 'anchor', name: 'toolbar' } as const;
const imagerySelector = { kind: 'anchor', name: 'imagery-selector' } as const;
const taskFilter = { kind: 'anchor', name: 'task-filter' } as const;
const mapControls = { kind: 'anchor', name: 'map-controls' } as const;
const collectionPicker = { kind: 'anchor', name: 'collection-picker' } as const;
const slicePicker = { kind: 'anchor', name: 'slice-picker' } as const;
const viewSync = { kind: 'anchor', name: 'view-sync' } as const;
const canvas = { kind: 'anchor', name: 'canvas' } as const;
const layerSelector = { kind: 'anchor', name: 'layer-selector' } as const;
const reviewToggle = { kind: 'anchor', name: 'review-toggle' } as const;
const layoutControls = { kind: 'anchor', name: 'layout-controls' } as const;
const campaignGuide = { kind: 'anchor', name: 'campaign-guide' } as const;
const keyboardHelp = { kind: 'anchor', name: 'keyboard-help' } as const;
const googleEarth = { kind: 'anchor', name: 'open-in-google-earth' } as const;
const mainMap = { kind: 'panel', id: 'main' } as const;
const minimap = { kind: 'panel', id: 'minimap' } as const;
const controls = { kind: 'panel', id: 'controls' } as const;
const imageryWindows = { kind: 'role', name: 'imagery-window' } as const;
const timeseries = { kind: 'role', name: 'timeseries' } as const;

const WINDOWS_VS_SLICES = [
  'A Collection is a broad time range (e.g. a year or season). A Slice is a finer subdivision inside that collection (e.g. individual months).',
  'The main map always shows one slice at a time. The smaller imagery panels show the same slice but for different collections so you can compare across time.',
];

const ZOOM_AND_PAN: Pick<TourStep, 'body' | 'hint' | 'requiredKeys' | 'placement'> = {
  body: [
    'Press {{alt+arrowup}} to zoom in and {{alt+arrowdown}} to zoom out. You can also scroll with the mouse wheel.',
    'Use the arrow keys ({{arrowup}} {{arrowdown}} {{arrowleft}} {{arrowright}}) to pan the map without the mouse.',
  ],
  hint: 'Try Alt and the up arrow to zoom in, then Alt and the down arrow to zoom back out.',
  requiredKeys: ['alt+arrowup', 'alt+arrowdown'],
  placement: 'bottom',
};

/** Entering it steps forward first when the workspace sits on the very first
 *  slice, so pressing A is a real move rather than a silent no-op. */
const SLICE_PRACTICE_STEP: TourStep = {
  id: 'practice-slices',
  target: [slicePicker, mainMap],
  title: 'Practice: Navigate Slices',
  body: [
    'Press {{a}} to go to the previous slice and {{d}} to go to the next slice. The slice picker follows along, so you can see where you are.',
  ],
  hint: 'Try pressing A and then D, so you have moved in both directions.',
  placement: 'bottom',
  requiredKeys: ['a', 'd'],
  effect: 'slice-headroom',
};

const SOURCE_SWITCHING_BODY = [
  'Open this dropdown to switch between imagery sources - the top-level groups here (e.g. Sentinel-2, Landsat, basemaps).',
  'You can also press {{i}} to cycle through sources without opening the dropdown.',
];

const GUIDE_STEP: TourStep = {
  id: 'campaign-guide',
  target: campaignGuide,
  title: 'Campaign Guide',
  body: [
    'Each campaign can include a guide written by its owner with instructions, label definitions, and examples. Open it from the toolbar.',
    'If the guide is empty, ask your campaign admin to fill it in from Campaign Settings.',
  ],
  placement: 'bottom',
};

const HELP_STEP: TourStep = {
  id: 'keyboard-help',
  target: keyboardHelp,
  title: 'Keyboard Help',
  body: [
    'This button opens the full keyboard shortcuts reference. It is built from the shortcuts that are actually active right now, so it always matches the mode you are in.',
  ],
  hint: 'Open it now.',
  placement: 'bottom',
  requiredClick: true,
  requiredClickLabel: 'the keyboard shortcuts button',
};

const RESIZE_STEP: TourStep = {
  id: 'practice-resize',
  target: [canvas, layoutControls],
  title: 'Practice: Resize Panels',
  body: [
    "We've enabled Edit Layout mode for you. Try dragging a panel header to move it, or drag a panel's edge or corner to resize it - every panel on the canvas is draggable and resizable right now.",
    "When you're done, click Save to keep the layout, or Cancel to discard your changes.",
  ],
  placement: 'bottom',
  effect: 'edit-layout',
};

const LAYOUT_STEP: TourStep = {
  id: 'layout-controls',
  target: layoutControls,
  title: 'Layout Controls',
  body: [
    'Click Edit Layout to drag and resize all the panels to your liking. Save as a personal or default layout for the campaign. Use the fullscreen button to maximize the annotation workspace.',
  ],
  placement: 'bottom',
};

function taskModeSteps({ hasTimeseries, hasFormFields }: TourConfig): TourStep[] {
  return [
    {
      id: 'welcome',
      target: toolbar,
      title: 'Welcome to STACNotator!',
      body: [
        'This guided tour will walk you through all the key features of the annotation workspace.',
        'Almost every action has a keyboard shortcut, making your workflow fast and seamless. We recommend trying to use only the keyboard for a better experience.',
      ],
      placement: 'bottom',
    },
    {
      id: 'task-filter',
      target: taskFilter,
      title: 'Task Filter',
      body: [
        'Filter which tasks are visible - by assignee, status, or a combination. Useful when you want to focus on "pending" tasks or review a specific user\'s work.',
      ],
      placement: 'bottom',
    },
    {
      id: 'main-map',
      target: mainMap,
      title: 'Main Map',
      body: [
        "This is the primary map view. It shows the selected imagery at the current collection & slice. Use your mouse to pan and scroll to zoom, or try the keyboard shortcuts you'll learn next.",
      ],
      placement: 'right',
    },
    {
      id: 'collection-picker',
      target: collectionPicker,
      title: 'Collection Picker',
      body: [
        'This picker lists all collections in chronological order, and highlights the active one. A collection is a broad time range of imagery. Pick one to jump straight to it.',
      ],
      placement: 'bottom',
    },
    {
      id: 'windows-vs-slices',
      target: slicePicker,
      title: 'Collections vs Slices',
      body: WINDOWS_VS_SLICES,
      placement: 'bottom',
    },
    SLICE_PRACTICE_STEP,
    {
      id: 'practice-windows',
      target: collectionPicker,
      title: 'Practice: Navigate Collections',
      body: [
        'Press {{shift+a}} to go to the previous collection and {{shift+d}} to go to the next collection. Often you will want to browse imagery in these bigger steps rather than individually by slice, as the first slice (cover slice) is often representative of the whole collection. These are also preloaded at your default zoom-level to make your workflow faster. Set the default zoom in campaign settings for the best experience.',
      ],
      hint: 'Try pressing Shift+A and then Shift+D, so you have navigated in both directions.',
      placement: 'bottom',
      requiredKeys: ['shift+a', 'shift+d'],
      effect: 'collection-headroom',
    },
    {
      id: 'hold-to-cycle',
      target: collectionPicker,
      title: 'Tip: Hold to Cycle',
      body: [
        'You can hold {{a}} / {{d}} or {{shift+a}} / {{shift+d}} to smoothly cycle through slices or collections without releasing the key. This is great for spotting changes across time in a flickering animation style.',
      ],
      hint: 'Try holding Shift+D for a moment to see it in action.',
      placement: 'bottom',
    },
    {
      id: 'map-controls',
      target: mapControls,
      title: 'Map Controls',
      body: ['These controls in the header bar let you manage the map:'],
      bullets: [
        { text: 'Layer / Collection / Slice selectors - switch imagery directly' },
        { text: 'Recenter - snap back to the task location ({{ }})' },
        { text: 'Crosshair - toggle the crosshair overlay ({{x}})' },
        {
          text: 'Timeseries probe - click the map to move the probe, + to drop another one to compare',
        },
      ],
      placement: 'bottom',
    },
    {
      id: 'practice-recenter',
      target: mainMap,
      title: 'Practice: Recenter Map',
      body: ['Press {{ }} to recenter the map on the current task location.'],
      hint: 'Try pressing Space now.',
      placement: 'bottom',
      requiredKeys: [' '],
    },
    {
      id: 'practice-crosshair',
      target: mainMap,
      title: 'Practice: Toggle Crosshair',
      body: ['Press {{x}} to toggle the crosshair overlay on the map.'],
      hint: 'Try pressing X now.',
      placement: 'bottom',
      requiredKeys: ['x'],
    },
    {
      id: 'imagery-windows',
      target: imageryWindows,
      title: 'Imagery Panels',
      body: [
        'These smaller panels each show a different collection at the same geographic location. Click a panel to make it the active collection in the main map.',
        'This lets you quickly compare how a location looks across different time periods.',
      ],
      placement: 'top',
    },
    {
      id: 'view-sync',
      target: viewSync,
      title: 'Imagery Panel Sync (View Link)',
      body: [
        'Press {{l}} to toggle view sync. When enabled, all imagery panels share the same slice index and visualization layer as the main map - so navigating slices updates every panel at once.',
        'Tip: turning view sync off can noticeably speed up imagery loading, because only the main map needs to fetch new tiles when you navigate. The smaller panels will stay on their current slice until you click them.',
      ],
      placement: 'bottom',
    },
    ...(hasTimeseries
      ? [
          {
            id: 'timeseries',
            target: timeseries,
            title: 'Time Series Chart',
            body: [
              'The time series chart shows spectral indices (e.g. NDVI) for the task location over time. Vertical bars indicate the currently selected collection/slice.',
              'Pick up the timeseries probe from the map controls, then click the map to place it there. The + beside it drops a second probe so two places can be compared, and clicking a probe again takes it off the chart.',
              'The options menu (sliders icon) offers two useful filters: Remove Cloudy hides observations that were flagged as cloud-covered, and Smooth applies a Savitzky-Golay filter to the curve so seasonal patterns are easier to spot. When smoothing is enabled you can adjust the window size and polynomial order to fine-tune the result.',
            ],
            placement: 'left' as const,
          },
        ]
      : []),
    {
      id: 'minimap',
      target: minimap,
      title: 'Minimap',
      body: [
        "The minimap gives you a bird's-eye overview of the campaign area. The marker shows the current task location. Coordinates are shown in the header - click the copy icon to grab them or hit the link to open in Google Earth.",
      ],
      placement: 'left',
    },
    {
      id: 'practice-google-earth',
      target: googleEarth,
      title: 'Practice: Open in Google Earth',
      body: [
        "Click the highlighted Open in Google Earth link to inspect the current task location in Google Earth. A new tab will open with the coordinates pre-filled - handy for high-resolution context when imagery alone isn't enough.",
      ],
      hint: 'Click the link now.',
      placement: 'left',
      requiredClick: true,
      requiredClickLabel: 'Open in Google Earth',
    },
    {
      id: 'controls',
      target: controls,
      title: 'Annotation Controls',
      body: ['This panel is where you actually annotate:'],
      bullets: [
        { text: 'Select a label (or press the number keys 1-9)' },
        ...(hasFormFields
          ? [
              {
                text: 'Answer the campaign’s questions below the labels - {{tab}} moves between them, and required ones must be filled in before the task can be submitted',
              },
            ]
          : []),
        { text: 'Optionally add a comment (press {{c}} to focus it)' },
        { text: 'Adjust your confidence level with {{q}} / {{e}}' },
        { text: 'Press {{enter}} to submit, or use the Skip button to move on' },
      ],
      placement: 'left',
    },
    {
      id: 'practice-tasks',
      target: controls,
      title: 'Practice: Navigate Tasks',
      body: ['Press {{w}} for the previous task and {{s}} for the next task.'],
      hint: 'Try pressing S and then W to move in both directions.',
      placement: 'left',
      requiredKeys: ['s', 'w'],
    },
    { id: 'practice-zoom', target: mainMap, title: 'Practice: Zoom & Pan', ...ZOOM_AND_PAN },
    {
      id: 'imagery-sources',
      target: layerSelector,
      title: 'Switching Imagery Sources',
      body: SOURCE_SWITCHING_BODY,
      placement: 'left',
    },
    {
      id: 'visualizations',
      target: layerSelector,
      title: 'Switching Visualization Layers',
      body: [
        "The same dropdown lists every source as a heading with its own visualization layers underneath (e.g. True Color, False Color, NDVI). Pick one to change how that source is rendered. {{shift+i}} cycles through the current source's visualizations.",
        'Note: visualization options are only available for sources that have them configured. Basemaps typically do not have multiple visualizations - only sources like Sentinel-2 with pre-configured band combinations will show visualization options.',
      ],
      placement: 'left',
    },
    {
      id: 'review-mode',
      target: reviewToggle,
      title: 'Review Mode',
      body: ['STACNotator has two ways to review annotations:'],
      bullets: [
        {
          text: "Review toggle (eye icon) - enables review mode directly on this annotation page. You'll see all annotators' labels for each task in the controls panel. If multiple annotators disagree on a task, there are two ways to resolve this:",
          sub: [
            'Update your label to match others if you think they are correct',
            'Update your comment to explain why you think the other annotators are wrong or why you disagree with them, and wait for them to revisit this point.',
            'Authorized reviewers can bypass the consensus finding by setting a label that has precedence over the other labels.',
          ],
        },
        {
          text: 'Review list (list icon) - navigates to a dedicated review page with a table overview of all annotations, agreement statistics, and filtering options.',
        },
      ],
      placement: 'bottom',
    },
    {
      id: 'canvas-views',
      target: imagerySelector,
      title: 'Canvas Views',
      body: [
        'Use this dropdown to switch between the different canvas views configured for this campaign. Each view may have its own imagery collections, slices, and visualization layers and help you to organize different imagery sources meaningfully.',
      ],
      placement: 'bottom',
    },
    LAYOUT_STEP,
    RESIZE_STEP,
    GUIDE_STEP,
    HELP_STEP,
    {
      id: 'complete',
      target: toolbar,
      title: 'Tour Complete',
      body: [
        "You're all set! STACNotator is designed to be keyboard-first - nearly every action has a shortcut, so you can annotate efficiently without ever reaching for the mouse. Here's your cheat-sheet:",
      ],
      cheatSheet: [
        { label: 'Navigate tasks', keys: ['w', 's'] },
        { label: 'Navigate slices', keys: ['a', 'd'] },
        { label: 'Navigate collections', keys: ['shift+a', 'shift+d'] },
        { label: 'Zoom in / out', keys: ['alt+arrowup', 'alt+arrowdown'] },
        { label: 'Pan map', keys: ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'] },
        { label: 'Recenter', keys: [' '] },
        { label: 'Toggle crosshair', keys: ['x'] },
        { label: 'Cycle imagery', keys: ['i'] },
        { label: 'Cycle visualization', keys: ['shift+i'] },
        { label: 'Toggle view sync', keys: ['l'] },
        { label: 'Select label', text: '1-9' },
        { label: 'Focus comment', keys: ['c'] },
        { label: 'Adjust confidence', keys: ['q', 'e'] },
        { label: 'Submit', keys: ['enter'] },
      ],
      placement: 'bottom',
    },
  ];
}

function exploreModeSteps({ hasTimeseries, hasFormFields }: TourConfig): TourStep[] {
  const toolKeys = hasTimeseries ? ['p', 'r', 'e', 't'] : ['p', 'r', 'e'];

  return [
    {
      id: 'welcome',
      target: toolbar,
      title: 'Welcome to Explore!',
      body: [
        'In Explore you draw annotations directly on the map. This tour will guide you through the key features. Like Tasks mode, almost every action has a keyboard shortcut.',
      ],
      placement: 'bottom',
    },
    {
      id: 'collection-picker',
      target: collectionPicker,
      title: 'Collection Picker',
      body: [
        'This picker lists all collections in chronological order, and highlights the active one. Picking one jumps straight to it - often faster than stepping with {{shift+a}} / {{shift+d}}.',
      ],
      placement: 'bottom',
    },
    {
      id: 'windows-vs-slices',
      target: slicePicker,
      title: 'Collections & Slices',
      body: WINDOWS_VS_SLICES,
      placement: 'bottom',
    },
    {
      id: 'imagery-windows',
      target: imageryWindows,
      title: 'Imagery Panels',
      body: [
        'These smaller panels each show a different collection at the same geographic location. Click a panel to make it the active collection in the main map.',
        "This lets you quickly compare how a location looks across different time periods. The main map will update to show that collection's imagery at full size.",
      ],
      placement: 'top',
    },
    SLICE_PRACTICE_STEP,
    {
      id: 'practice-windows',
      target: collectionPicker,
      title: 'Practice: Navigate Collections',
      body: [
        'Press {{shift+a}} to go to the previous collection and {{shift+d}} to go to the next collection.',
      ],
      hint: 'Try pressing Shift+A and then Shift+D, so you have navigated in both directions.',
      placement: 'bottom',
      requiredKeys: ['shift+a', 'shift+d'],
      effect: 'collection-headroom',
    },
    {
      id: 'imagery-sources',
      target: layerSelector,
      title: 'Switching Imagery Sources',
      body: SOURCE_SWITCHING_BODY,
      placement: 'left',
    },
    {
      id: 'visualizations',
      target: layerSelector,
      title: 'Switching Visualization Layers',
      body: [
        "The same dropdown lists every source as a heading with its own visualization layers underneath (e.g. True Color, False Color, NDVI). Pick one to change how that source is rendered. {{shift+i}} cycles through the current source's visualizations.",
        'Note: the canvas view dropdown in the toolbar selects which view is active, while these controls switch the imagery source and visualization within that view.',
      ],
      placement: 'left',
    },
    {
      id: 'view-sync',
      target: viewSync,
      title: 'Imagery Panel Sync (View Link)',
      body: [
        'Press {{l}} to toggle view sync. When enabled, all imagery panels share the same slice index and visualization layer as the main map - so navigating slices updates every panel at once.',
        'Tip: turning view sync off can noticeably speed up imagery loading, because only the main map needs to fetch new tiles when you navigate.',
      ],
      placement: 'left',
    },
    {
      id: 'main-map',
      target: mainMap,
      title: 'Main Map',
      body: [
        hasTimeseries
          ? 'This is your drawing canvas. Use the tools ({{p}}, {{r}}, {{e}}, {{b}}, {{t}}) to pan, annotate, edit features, label vector features, or probe time series. Use the mouse wheel to zoom and click-drag to pan.'
          : 'This is your drawing canvas. Use the tools ({{p}}, {{r}}, {{e}}, {{b}}) to pan, annotate, edit features, or label vector features. Use the mouse wheel to zoom and click-drag to pan.',
        'Press {{ }} to fit the view to everything you have drawn.',
      ],
      placement: 'right',
    },
    {
      id: 'controls',
      target: controls,
      title: 'Annotation Controls',
      body: [
        "We've switched the Annotate tool on for you, so the labels are on screen: the labels section lists the campaign's annotation classes and their geometry types (point, polygon, line).",
        'Pick a label, then draw on the map. The number keys 1-9 pick a label and switch to the Annotate tool in one go.',
      ],
      placement: 'left',
      effect: 'annotate-tool',
    },
    {
      id: 'drawing',
      target: [mainMap, controls],
      title: 'Drawing an Annotation',
      body: ['Pick a label first - the label decides the shape you draw.'],
      bullets: [
        { text: 'Point labels: one click on the map and it is placed.' },
        {
          text: 'Polygon and line labels: click each corner in turn, then finish with {{enter}} or a double-click.',
        },
        { text: '{{escape}} while drawing throws the shape away and starts over.' },
      ],
      placement: 'right',
    },
    ...(hasFormFields
      ? [
          {
            id: 'annotation-questions',
            target: controls,
            title: 'Answering the Questions',
            body: [
              'This campaign asks a few questions about every annotation. The moment a shape is finished, the label list here is replaced by those questions.',
              '{{tab}} and {{shift+tab}} move between the questions, and {{enter}} saves the annotation once they are answered. Anything marked required has to be filled in - closing the panel without it discards the annotation.',
            ],
            placement: 'left' as const,
          },
        ]
      : []),
    {
      id: 'editing',
      target: [mainMap, controls],
      title: 'Changing and Removing Annotations',
      body: ['Switch to the Edit tool with {{e}}, then click a shape on the map to pick it up.'],
      bullets: [
        { text: 'Drag its vertices to reshape it, then {{enter}} to keep the change.' },
        { text: '{{escape}} drops the selection and leaves the annotation as it was.' },
        {
          text: hasFormFields
            ? 'The panel on the left shows its label and answers while it is selected - both can be changed there and saved.'
            : 'The panel on the left shows its label while it is selected, and lets you change it.',
        },
        { text: '{{delete}} removes the selected annotation for good.' },
      ],
      hint: 'You can only change or delete other people’s annotations if the campaign allows it.',
      placement: 'right',
    },
    {
      id: 'practice-tools',
      target: [controls, mainMap],
      title: 'Practice: Tool Switching',
      body: [
        hasTimeseries
          ? '{{p}} = Pan, {{r}} = Annotate, {{e}} = Edit, {{t}} = Timeseries'
          : '{{p}} = Pan, {{r}} = Annotate, {{e}} = Edit',
      ],
      hint: hasTimeseries ? 'Try each of P, R, E and T.' : 'Try each of P, R and E.',
      placement: 'bottom',
      requiredKeys: toolKeys,
    },
    { id: 'practice-zoom', target: mainMap, title: 'Practice: Zoom & Pan', ...ZOOM_AND_PAN },
    {
      id: 'minimap',
      target: minimap,
      title: 'Minimap',
      body: [
        "The minimap gives you a bird's-eye overview of the campaign area. Click anywhere in it to move the main map there - it keeps the main map's current zoom level, so you jump across the campaign area without changing scale. Dragging the viewport rectangle does the same.",
        'The header shows the coordinates of the current viewport center (where the crosshair sits). Click the copy icon to copy them to your clipboard, or click the link icon to open the location in Google Earth.',
      ],
      placement: 'left',
    },
    {
      id: 'practice-google-earth',
      target: googleEarth,
      title: 'Practice: Open in Google Earth',
      body: [
        "Click the highlighted Open in Google Earth link to inspect the current viewport center in Google Earth. A new tab will open with the coordinates pre-filled - handy for high-resolution context when imagery alone isn't enough.",
      ],
      hint: 'Click the link now.',
      placement: 'left',
      requiredClick: true,
      requiredClickLabel: 'Open in Google Earth',
    },
    ...(hasTimeseries
      ? [
          {
            id: 'timeseries',
            target: timeseries,
            title: 'Time Series Chart',
            body: [
              'The time series chart shows spectral indices (e.g. NDVI) over time. Switch to the Timeseries tool ({{t}}) and click the map to move the probe there; + in the map header (or {{shift+t}}) drops another one so two places can be compared.',
              'The options menu (sliders icon) offers two useful filters: Remove Cloudy hides cloud-flagged observations, and Smooth applies a Savitzky-Golay filter so seasonal patterns are easier to spot. When smoothing is enabled you can adjust the window size and polynomial order to fine-tune the result.',
            ],
            placement: 'left' as const,
          },
        ]
      : []),
    {
      id: 'canvas-view',
      target: imagerySelector,
      title: 'Canvas View',
      body: [
        'This dropdown selects the active canvas view. A view is a campaign-level grouping that defines which imagery sources and collections are shown together - think of it as a preset for the whole annotation workspace.',
        'Switching views may change the available collections, slices, imagery sources, and visualization layers all at once.',
      ],
      placement: 'bottom',
    },
    LAYOUT_STEP,
    RESIZE_STEP,
    GUIDE_STEP,
    HELP_STEP,
    {
      id: 'complete',
      target: toolbar,
      title: 'Tour Complete',
      body: [
        "You're ready to start annotating in Explore! STACNotator is designed to be keyboard-first - here's your cheat-sheet:",
      ],
      cheatSheet: [
        { label: 'Pan tool', keys: ['p'] },
        { label: 'Annotate tool', keys: ['r'] },
        { label: 'Edit tool', keys: ['e'] },
        { label: 'Label vector features', keys: ['b'] },
        ...(hasTimeseries ? [{ label: 'Timeseries tool', keys: ['t'] }] : []),
        { label: 'Navigate slices', keys: ['a', 'd'] },
        { label: 'Navigate collections', keys: ['shift+a', 'shift+d'] },
        { label: 'Zoom in / out', keys: ['alt+arrowup', 'alt+arrowdown'] },
        { label: 'Pan map', keys: ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'] },
        { label: 'Fit to annotations', keys: [' '] },
        { label: 'Select label', text: '1-9' },
        { label: 'Save the drawn shape', keys: ['enter'] },
        { label: 'Cancel the edit', keys: ['escape'] },
        { label: 'Delete the selection', keys: ['delete'] },
        ...(hasFormFields ? [{ label: 'Cycle form fields', keys: ['tab'] }] : []),
        { label: 'Cycle imagery', keys: ['i'] },
        { label: 'Cycle visualization', keys: ['shift+i'] },
        { label: 'Toggle view sync', keys: ['l'] },
      ],
      placement: 'bottom',
    },
  ];
}

export function buildTourSteps(variant: TourVariant, config: TourConfig): TourStep[] {
  return variant === 'explore' ? exploreModeSteps(config) : taskModeSteps(config);
}
