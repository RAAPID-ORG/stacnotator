import i18n from '~/shared/i18n';
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
const taskFilterMenu = { kind: 'anchor', name: 'task-filter-menu' } as const;
const mapControls = { kind: 'anchor', name: 'map-controls' } as const;
const mapActions = { kind: 'anchor', name: 'map-actions' } as const;
const collectionPicker = { kind: 'anchor', name: 'collection-picker' } as const;
const slicePicker = { kind: 'anchor', name: 'slice-picker' } as const;
const slicePickerMenu = { kind: 'anchor', name: 'slice-picker-menu' } as const;
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

/** Collections and slices are one idea, not two, and their pickers sit next to
 *  each other - so one step lights both, with the slice list held open so the
 *  finer grain is something the reader can see rather than take on trust. */
const collectionsAndSlicesStep = (): TourStep => ({
  id: 'collections-and-slices',
  target: [collectionPicker, slicePicker, slicePickerMenu],
  title: i18n.t('annotation:tour.collectionsAndSlices.title'),
  body: i18n.t('annotation:tour.collectionsAndSlices.body', { returnObjects: true }),
  placement: 'bottom',
  effect: 'show-slice-menu',
});

/** Both modes describe the small panels the same way, including the click that
 *  is the least discoverable thing on the canvas - nothing on the panel
 *  advertises it. */
const imageryWindowsStep = (): TourStep => ({
  id: 'imagery-windows',
  target: [imageryWindows, mainMap],
  title: i18n.t('annotation:tour.imageryWindows.title'),
  body: i18n.t('annotation:tour.imageryWindows.body', { returnObjects: true }),
  placement: 'top',
});

const zoomAndPanStep = (): TourStep => ({
  id: 'practice-zoom',
  target: mainMap,
  title: i18n.t('annotation:tour.zoomAndPan.title'),
  body: i18n.t('annotation:tour.zoomAndPan.body', { returnObjects: true }),
  hint: i18n.t('annotation:tour.zoomAndPan.hint'),
  requiredKeys: ['alt+arrowup', 'alt+arrowdown'],
  placement: 'bottom',
});

/** Entering it steps forward first when the workspace sits on the very first
 *  slice, so pressing A is a real move rather than a silent no-op. */
const slicePracticeStep = (): TourStep => ({
  id: 'practice-slices',
  target: [slicePicker, mainMap],
  avoid: mapControls,
  title: i18n.t('annotation:tour.practiceSlices.title'),
  body: i18n.t('annotation:tour.practiceSlices.body', { returnObjects: true }),
  hint: i18n.t('annotation:tour.practiceSlices.hint'),
  placement: 'bottom',
  requiredKeys: ['a', 'd'],
  effect: 'slice-headroom',
});

const guideStep = (): TourStep => ({
  id: 'campaign-guide',
  target: campaignGuide,
  title: i18n.t('annotation:tour.guide.title'),
  body: i18n.t('annotation:tour.guide.body', { returnObjects: true }),
  placement: 'bottom',
});

const helpStep = (): TourStep => ({
  id: 'keyboard-help',
  target: keyboardHelp,
  title: i18n.t('annotation:tour.help.title'),
  body: i18n.t('annotation:tour.help.body', { returnObjects: true }),
  hint: i18n.t('annotation:tour.help.hint'),
  placement: 'bottom',
  requiredClick: true,
  requiredClickLabel: i18n.t('annotation:tour.help.clickLabel'),
});

const resizeStep = (): TourStep => ({
  id: 'practice-resize',
  target: [canvas, layoutControls],
  // Keep the completion actions reachable while the tooltip covers the canvas.
  avoid: layoutControls,
  title: i18n.t('annotation:tour.resize.title'),
  body: i18n.t('annotation:tour.resize.body', { returnObjects: true }),
  placement: 'bottom',
  effect: 'edit-layout',
});

/** The old copy claimed view sync shares the slice and visualization. It does
 *  not - it is the panels' camera that follows, and skipping that follow is
 *  what saves the tile traffic. */
const viewSyncStep = (): TourStep => ({
  id: 'view-sync',
  target: [viewSync, imageryWindows],
  title: i18n.t('annotation:tour.viewSync.title'),
  body: i18n.t('annotation:tour.viewSync.body', { returnObjects: true }),
  placement: 'bottom',
});

/** Both a practice and a sandbox: the source ring includes basemaps, so
 *  pressing I a few times routinely ends on a street map. The step puts the
 *  imagery back on the way out so the next step is not talking over one. */
const sourcePracticeStep = (): TourStep => ({
  id: 'imagery-sources',
  target: [layerSelector, mainMap],
  avoid: mapControls,
  title: i18n.t('annotation:tour.sources.title'),
  body: i18n.t('annotation:tour.sources.body', { returnObjects: true }),
  hint: i18n.t('annotation:tour.sources.hint'),
  placement: 'left',
  requiredKeys: ['i'],
  effect: 'imagery-sandbox',
});

const visualizationPracticeStep = (): TourStep => ({
  id: 'visualizations',
  target: [layerSelector, mainMap],
  avoid: mapControls,
  title: i18n.t('annotation:tour.visualizations.title'),
  body: i18n.t('annotation:tour.visualizations.body', { returnObjects: true }),
  hint: i18n.t('annotation:tour.visualizations.hint'),
  placement: 'left',
  requiredKeys: ['shift+i'],
  effect: 'visualization-sandbox',
});

const layoutStep = (): TourStep => ({
  id: 'layout-controls',
  target: layoutControls,
  title: i18n.t('annotation:tour.layout.title'),
  body: i18n.t('annotation:tour.layout.body', { returnObjects: true }),
  placement: 'bottom',
});

const googleEarthStep = (body: string): TourStep => ({
  id: 'practice-google-earth',
  target: googleEarth,
  // The link lives in the minimap header, so "beside the link" is on top of
  // the minimap unless it is kept clear.
  avoid: minimap,
  title: i18n.t('annotation:tour.googleEarth.title'),
  body: [body],
  hint: i18n.t('annotation:tour.googleEarth.hint'),
  placement: 'left',
  requiredClick: true,
  requiredClickLabel: i18n.t('annotation:tour.googleEarth.clickLabel'),
});

const practiceWindowsStep = (body: string): TourStep => ({
  id: 'practice-windows',
  target: [collectionPicker, mainMap],
  avoid: mapControls,
  title: i18n.t('annotation:tour.practiceWindows.title'),
  body: [body],
  hint: i18n.t('annotation:tour.practiceWindows.hint'),
  placement: 'bottom',
  requiredKeys: ['shift+a', 'shift+d'],
  effect: 'collection-headroom',
});

const cheat = (
  key:
    | 'navigateTasks'
    | 'navigateSlices'
    | 'navigateCollections'
    | 'zoom'
    | 'panMap'
    | 'recenter'
    | 'toggleCrosshair'
    | 'cycleImagery'
    | 'cycleVisualization'
    | 'toggleViewSync'
    | 'selectLabel'
    | 'focusComment'
    | 'adjustConfidence'
    | 'submit'
    | 'panTool'
    | 'annotateTool'
    | 'editTool'
    | 'labelVector'
    | 'timeseriesTool'
    | 'fitAnnotations'
    | 'saveShape'
    | 'cancelEdit'
    | 'deleteSelection'
    | 'cycleFormFields'
) => i18n.t(`annotation:tour.cheatSheet.${key}`);

function taskModeSteps({ hasTimeseries, hasFormFields }: TourConfig): TourStep[] {
  return [
    {
      id: 'welcome',
      target: toolbar,
      title: i18n.t('annotation:tour.tasks.welcome.title'),
      body: i18n.t('annotation:tour.tasks.welcome.body', { returnObjects: true }),
      placement: 'bottom',
    },
    {
      id: 'task-filter',
      target: [taskFilter, taskFilterMenu],
      title: i18n.t('annotation:tour.tasks.taskFilter.title'),
      body: i18n.t('annotation:tour.tasks.taskFilter.body', { returnObjects: true }),
      placement: 'bottom',
      effect: 'show-task-filter',
    },
    {
      id: 'main-map',
      target: mainMap,
      title: i18n.t('annotation:tour.mainMapTitle'),
      body: i18n.t('annotation:tour.tasks.mainMap', { returnObjects: true }),
      placement: 'right',
      avoid: [mapControls, controls],
    },
    collectionsAndSlicesStep(),
    slicePracticeStep(),
    practiceWindowsStep(i18n.t('annotation:tour.tasks.practiceWindows')),
    {
      id: 'hold-to-cycle',
      target: [collectionPicker, mainMap],
      avoid: mapControls,
      title: i18n.t('annotation:tour.tasks.holdToCycle.title'),
      body: i18n.t('annotation:tour.tasks.holdToCycle.body', { returnObjects: true }),
      hint: i18n.t('annotation:tour.tasks.holdToCycle.hint'),
      placement: 'bottom',
    },
    {
      id: 'map-controls',
      target: [mapControls, mapActions],
      title: i18n.t('annotation:tour.tasks.mapControls.title'),
      body: i18n.t('annotation:tour.tasks.mapControls.body', { returnObjects: true }),
      bullets: i18n
        .t('annotation:tour.tasks.mapControls.bullets', { returnObjects: true })
        .map((text) => ({ text })),
      placement: 'bottom',
    },
    {
      id: 'practice-recenter',
      target: mainMap,
      title: i18n.t('annotation:tour.tasks.recenter.title'),
      body: i18n.t('annotation:tour.tasks.recenter.body', { returnObjects: true }),
      hint: i18n.t('annotation:tour.tasks.recenter.hint'),
      placement: 'bottom',
      requiredKeys: [' '],
    },
    {
      id: 'practice-crosshair',
      target: mainMap,
      title: i18n.t('annotation:tour.tasks.crosshair.title'),
      body: i18n.t('annotation:tour.tasks.crosshair.body', { returnObjects: true }),
      hint: i18n.t('annotation:tour.tasks.crosshair.hint'),
      placement: 'bottom',
      requiredKeys: ['x'],
    },
    imageryWindowsStep(),
    viewSyncStep(),
    ...(hasTimeseries
      ? [
          {
            id: 'timeseries',
            target: [timeseries, mainMap, mapControls],
            title: i18n.t('annotation:tour.timeseriesTitle'),
            body: i18n.t('annotation:tour.tasks.timeseries', { returnObjects: true }),
            placement: 'left' as const,
          },
        ]
      : []),
    {
      id: 'minimap',
      target: minimap,
      title: i18n.t('annotation:tour.minimapTitle'),
      body: i18n.t('annotation:tour.tasks.minimap', { returnObjects: true }),
      placement: 'left',
    },
    googleEarthStep(i18n.t('annotation:tour.tasks.googleEarth')),
    {
      id: 'controls',
      target: [controls, mainMap],
      title: i18n.t('annotation:tour.controlsTitle'),
      body: i18n.t('annotation:tour.tasks.controls.body', { returnObjects: true }),
      bullets: [
        { text: i18n.t('annotation:tour.tasks.controls.selectLabel') },
        ...(hasFormFields ? [{ text: i18n.t('annotation:tour.tasks.controls.formFields') }] : []),
        { text: i18n.t('annotation:tour.tasks.controls.comment') },
        { text: i18n.t('annotation:tour.tasks.controls.confidence') },
        { text: i18n.t('annotation:tour.tasks.controls.submit') },
      ],
      placement: 'left',
    },
    {
      id: 'practice-tasks',
      target: [controls, mainMap],
      title: i18n.t('annotation:tour.tasks.practiceTasks.title'),
      body: i18n.t('annotation:tour.tasks.practiceTasks.body', { returnObjects: true }),
      hint: i18n.t('annotation:tour.tasks.practiceTasks.hint'),
      placement: 'left',
      requiredKeys: ['s', 'w'],
    },
    zoomAndPanStep(),
    sourcePracticeStep(),
    visualizationPracticeStep(),
    {
      id: 'review-mode',
      target: reviewToggle,
      title: i18n.t('annotation:tour.tasks.review.title'),
      body: i18n.t('annotation:tour.tasks.review.body', { returnObjects: true }),
      bullets: [
        {
          text: i18n.t('annotation:tour.tasks.review.toggle'),
          sub: i18n.t('annotation:tour.tasks.review.toggleOptions', { returnObjects: true }),
        },
        { text: i18n.t('annotation:tour.tasks.review.list') },
      ],
      placement: 'bottom',
    },
    {
      id: 'canvas-views',
      target: imagerySelector,
      title: i18n.t('annotation:tour.tasks.canvasViews.title'),
      body: i18n.t('annotation:tour.tasks.canvasViews.body', { returnObjects: true }),
      placement: 'bottom',
    },
    layoutStep(),
    resizeStep(),
    guideStep(),
    helpStep(),
    {
      id: 'complete',
      target: toolbar,
      title: i18n.t('annotation:tour.completeTitle'),
      body: i18n.t('annotation:tour.tasks.complete', { returnObjects: true }),
      cheatSheet: [
        { label: cheat('navigateTasks'), keys: ['w', 's'] },
        { label: cheat('navigateSlices'), keys: ['a', 'd'] },
        { label: cheat('navigateCollections'), keys: ['shift+a', 'shift+d'] },
        { label: cheat('zoom'), keys: ['alt+arrowup', 'alt+arrowdown'] },
        { label: cheat('panMap'), keys: ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'] },
        { label: cheat('recenter'), keys: [' '] },
        { label: cheat('toggleCrosshair'), keys: ['x'] },
        { label: cheat('cycleImagery'), keys: ['i'] },
        { label: cheat('cycleVisualization'), keys: ['shift+i'] },
        { label: cheat('toggleViewSync'), keys: ['l'] },
        { label: cheat('selectLabel'), text: '1-9' },
        { label: cheat('focusComment'), keys: ['c'] },
        { label: cheat('adjustConfidence'), keys: ['q', 'e'] },
        { label: cheat('submit'), keys: ['enter'] },
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
      title: i18n.t('annotation:tour.explore.welcome.title'),
      body: i18n.t('annotation:tour.explore.welcome.body', { returnObjects: true }),
      placement: 'bottom',
    },
    {
      id: 'main-map',
      target: mainMap,
      title: i18n.t('annotation:tour.mainMapTitle'),
      body: [
        hasTimeseries
          ? i18n.t('annotation:tour.explore.mainMap.toolsWithTimeseries')
          : i18n.t('annotation:tour.explore.mainMap.tools'),
        i18n.t('annotation:tour.explore.mainMap.fit'),
      ],
      placement: 'right',
      // Both sets of controls the copy names: the header pickers and the tools
      // panel. Lighting the whole map leaves the tooltip nowhere obvious to go,
      // and it used to settle straight on top of them.
      avoid: [mapControls, controls],
    },
    collectionsAndSlicesStep(),
    imageryWindowsStep(),
    slicePracticeStep(),
    practiceWindowsStep(i18n.t('annotation:tour.explore.practiceWindows')),
    sourcePracticeStep(),
    visualizationPracticeStep(),
    viewSyncStep(),
    {
      id: 'controls',
      target: [controls, mainMap],
      title: i18n.t('annotation:tour.controlsTitle'),
      body: i18n.t('annotation:tour.explore.controls', { returnObjects: true }),
      placement: 'left',
      effect: 'annotate-tool',
    },
    {
      id: 'drawing',
      target: [mainMap, controls],
      title: i18n.t('annotation:tour.explore.drawing.title'),
      body: i18n.t('annotation:tour.explore.drawing.body', { returnObjects: true }),
      bullets: i18n
        .t('annotation:tour.explore.drawing.bullets', { returnObjects: true })
        .map((text) => ({ text })),
      placement: 'right',
    },
    ...(hasFormFields
      ? [
          {
            id: 'annotation-questions',
            target: [controls, mainMap],
            title: i18n.t('annotation:tour.explore.questions.title'),
            body: i18n.t('annotation:tour.explore.questions.body', { returnObjects: true }),
            placement: 'left' as const,
          },
        ]
      : []),
    {
      id: 'editing',
      target: [mainMap, controls],
      title: i18n.t('annotation:tour.explore.editing.title'),
      body: i18n.t('annotation:tour.explore.editing.body', { returnObjects: true }),
      bullets: [
        { text: i18n.t('annotation:tour.explore.editing.reshape') },
        { text: i18n.t('annotation:tour.explore.editing.escape') },
        {
          text: hasFormFields
            ? i18n.t('annotation:tour.explore.editing.panelWithAnswers')
            : i18n.t('annotation:tour.explore.editing.panel'),
        },
        { text: i18n.t('annotation:tour.explore.editing.delete') },
      ],
      hint: i18n.t('annotation:tour.explore.editing.hint'),
      placement: 'right',
    },
    {
      id: 'practice-tools',
      target: [controls, mainMap],
      title: i18n.t('annotation:tour.explore.tools.title'),
      body: [
        hasTimeseries
          ? i18n.t('annotation:tour.explore.tools.bodyWithTimeseries')
          : i18n.t('annotation:tour.explore.tools.body'),
      ],
      hint: hasTimeseries
        ? i18n.t('annotation:tour.explore.tools.hintWithTimeseries')
        : i18n.t('annotation:tour.explore.tools.hint'),
      placement: 'bottom',
      requiredKeys: toolKeys,
    },
    zoomAndPanStep(),
    {
      id: 'minimap',
      target: minimap,
      title: i18n.t('annotation:tour.minimapTitle'),
      body: i18n.t('annotation:tour.explore.minimap', { returnObjects: true }),
      placement: 'left',
    },
    googleEarthStep(i18n.t('annotation:tour.explore.googleEarth')),
    ...(hasTimeseries
      ? [
          {
            id: 'timeseries',
            target: [timeseries, mainMap],
            title: i18n.t('annotation:tour.timeseriesTitle'),
            effect: 'seed-probe' as const,
            body: i18n.t('annotation:tour.explore.timeseries', { returnObjects: true }),
            placement: 'left' as const,
          },
        ]
      : []),
    {
      id: 'canvas-view',
      target: imagerySelector,
      title: i18n.t('annotation:tour.explore.canvasView.title'),
      body: i18n.t('annotation:tour.explore.canvasView.body', { returnObjects: true }),
      placement: 'bottom',
    },
    layoutStep(),
    resizeStep(),
    guideStep(),
    helpStep(),
    {
      id: 'complete',
      target: toolbar,
      title: i18n.t('annotation:tour.completeTitle'),
      body: i18n.t('annotation:tour.explore.complete', { returnObjects: true }),
      cheatSheet: [
        { label: cheat('panTool'), keys: ['p'] },
        { label: cheat('annotateTool'), keys: ['r'] },
        { label: cheat('editTool'), keys: ['e'] },
        { label: cheat('labelVector'), keys: ['b'] },
        ...(hasTimeseries ? [{ label: cheat('timeseriesTool'), keys: ['t'] }] : []),
        { label: cheat('navigateSlices'), keys: ['a', 'd'] },
        { label: cheat('navigateCollections'), keys: ['shift+a', 'shift+d'] },
        { label: cheat('zoom'), keys: ['alt+arrowup', 'alt+arrowdown'] },
        { label: cheat('panMap'), keys: ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'] },
        { label: cheat('fitAnnotations'), keys: [' '] },
        { label: cheat('selectLabel'), text: '1-9' },
        { label: cheat('saveShape'), keys: ['enter'] },
        { label: cheat('cancelEdit'), keys: ['escape'] },
        { label: cheat('deleteSelection'), keys: ['delete'] },
        ...(hasFormFields ? [{ label: cheat('cycleFormFields'), keys: ['tab'] }] : []),
        { label: cheat('cycleImagery'), keys: ['i'] },
        { label: cheat('cycleVisualization'), keys: ['shift+i'] },
        { label: cheat('toggleViewSync'), keys: ['l'] },
      ],
      placement: 'bottom',
    },
  ];
}

export function buildTourSteps(variant: TourVariant, config: TourConfig): TourStep[] {
  return variant === 'explore' ? exploreModeSteps(config) : taskModeSteps(config);
}
