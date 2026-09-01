/**
 * Every keyboard shortcut the annotation page has, and what each one runs.
 * `pageKeymap()` at the bottom assembles them in precedence order; `hotkeys.ts`
 * is the mechanism that dispatches them and renders their help text.
 */
import type { LabelBase } from '~/api/client';
import { useLayoutStore as useGlobalLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import { DIGIT_INPUT_TIMEOUT_MS } from '~/shared/utils/constants';
import { focusFormFieldInput, reveal, revealAndFocus } from './components/FormFields';
import { commitEdit, deleteSelection } from './drawing';
import type { Binding } from './hotkeys';
import {
  handleFormFieldKey,
  LABEL_FIELD_INDEX,
  type FormField,
  type FormKeyContext,
} from './campaign/annotation';
import { readyCustomMaps } from './campaign/imagery';
import { rememberAddress, type SliceAddress } from './campaign/imageryNav';
import { fitAnnotations, mainCamera, minimapCamera, pan, zoom } from './map/camera';
import { tasksModeTarget } from '~/shared/map/minimap/follow';
import {
  campaignState,
  formFields,
  toPolicyContext,
  useCampaignStore,
  type WorkMode,
} from './stores/campaign';
import { isAudienceMember } from '~/features/campaigns/utils/labellingPolicy';
import { useImageryStore } from './stores/imagery';
import { useTasksStore } from './stores/tasks';
import { useWorkStore, type Tool } from './stores/work';
import {
  advance,
  skipCurrent,
  submitAnnotation,
  submitAuthoritative,
  DEFAULT_CONFIDENCE,
} from './taskActions';

const alert = (message: string, kind: 'error' | 'success') =>
  useGlobalLayoutStore.getState().showAlert(message, kind);

// ---------------------------------------------------------------------------
// Held-key slice scrubbing. OS key repeat is far faster than imagery can keep
// up with, so A/D repeat on their own cadence instead.
// ---------------------------------------------------------------------------

const AUTONAV_INTERVAL_MS = 500;

let autoNavTimer: ReturnType<typeof setInterval> | null = null;
let autoNavStop: (() => void) | null = null;

function stopAutoNav(): void {
  if (autoNavTimer) clearInterval(autoNavTimer);
  autoNavTimer = null;
  autoNavStop?.();
  autoNavStop = null;
}

/** Repeats until the key comes back up, or the window loses focus - which
 *  never delivers that keyup. */
function startAutoNav(step: () => void): void {
  stopAutoNav();
  autoNavTimer = setInterval(step, AUTONAV_INTERVAL_MS);
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() === 'a' || e.key.toLowerCase() === 'd') stopAutoNav();
  };
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', stopAutoNav);
  autoNavStop = () => {
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', stopAutoNav);
  };
}

/**
 * Where each source was last looked at, so cycling back returns to its own
 * collection and slice. The layer dropdown writes here too, so both routes
 * into a source share one memory.
 */
let lastBySource: Record<number, SliceAddress> = {};

export function rememberLastAddress(addr: SliceAddress | null): void {
  lastBySource = rememberAddress(lastBySource, addr);
}

/** Both are scoped to one campaign's catalog: a held-down A/D outliving the
 *  page would step slices of a campaign nobody is on, and `lastBySource`
 *  would send the next campaign's cycling to an address from the last. */
export function resetNavMemory(): void {
  stopAutoNav();
  lastBySource = {};
  resetDigitBuffer();
}

// ---------------------------------------------------------------------------
// Two-digit label selection
// ---------------------------------------------------------------------------

let digitBuffer = '';
let digitTimer: ReturnType<typeof setTimeout> | null = null;

function clearDigitBuffer(): void {
  if (digitTimer) clearTimeout(digitTimer);
  digitTimer = null;
  digitBuffer = '';
}

export const resetDigitBuffer = clearDigitBuffer;

function commitDigits(labels: LabelBase[]): void {
  const position = parseInt(digitBuffer, 10);
  clearDigitBuffer();
  const label = labels[position - 1];
  if (!label) return;
  const work = useWorkStore.getState();
  work.setSelectedLabelId(work.selectedLabelId === label.id ? null : label.id);
}

/** Buffers up to two digits so label 12 can be typed as two keystrokes rather
 *  than jumping to label 1 on the first. */
function handleDigitInput(digit: string, labels: LabelBase[]): void {
  if (digitTimer) clearTimeout(digitTimer);
  digitBuffer += digit;
  const value = parseInt(digitBuffer, 10);
  const couldGrow = value * 10 <= labels.length;
  if (value > labels.length || !couldGrow || digitBuffer.length >= 2) commitDigits(labels);
  else digitTimer = setTimeout(() => commitDigits(labels), DIGIT_INPUT_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// Form field keys
// ---------------------------------------------------------------------------

const FORM_INPUT_SELECTOR = '[data-form-field-id],[data-task-comment-input]';
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

const commentBox = () => document.querySelector<HTMLTextAreaElement>('[data-task-comment-input]');
const commentIsFocused = () => commentBox() !== null && document.activeElement === commentBox();

/**
 * Whether the form's Tab and Escape may claim this keystroke. They get past
 * the typing guard so a focused field can be left again, which would
 * otherwise hijack both keys inside every other input on the page - search
 * boxes and dialogs stay with the browser.
 */
function formKeysApply(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return true;
  if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return true;
  return active.closest(FORM_INPUT_SELECTOR) !== null;
}

function formKeyContext(): FormKeyContext {
  const work = useWorkStore.getState();
  return {
    fields: formFields(),
    activeIndex: work.activeFieldIndex,
    values: work.formValues,
    setValues: work.setFormValues,
    setActiveIndex: work.setActiveFieldIndex,
  };
}

function activeFormField(): FormField | undefined {
  const { fields, activeIndex } = formKeyContext();
  return activeIndex !== null && activeIndex >= 0 ? fields[activeIndex] : undefined;
}

/**
 * `handleFormFieldKey` decides which field a key moves to; the focus call is
 * ours. It never names a field for Tab (the new slot may be a
 * category field or the label picker, neither with an input) or Escape, so
 * those two are resolved here from the post-move state and the live focus.
 */
function runFormKey(e: KeyboardEvent): void {
  const { focusFieldId } = handleFormFieldKey(e, formKeyContext());
  if (focusFieldId !== null) {
    focusFormFieldInput(focusFieldId);
    return;
  }
  if (e.key === 'Tab') {
    const field = activeFormField();
    if (field) focusFormFieldInput(field.id);
    else if (formKeyContext().activeIndex === LABEL_FIELD_INDEX) {
      revealAndFocus(document.querySelector<HTMLElement>('[data-task-labels]'));
    }
    return;
  }
  if (e.key === 'Escape') blurFormInput();
}

/** Leave the field being typed in before its answer is read: a number field
 *  clamps to its range on blur, so saving straight out of the input would
 *  store the unclamped value. */
function blurFormInput(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest(FORM_INPUT_SELECTOR)) active.blur();
}

/** A multiline answer owns its own Enter - it is a newline there. */
const typingMultiline = (): boolean => document.activeElement?.tagName === 'TEXTAREA';

/** Digits answer whichever custom field is active. Both modes need these:
 *  Explore's questions catalog highlights a field and renders the same hints. */
function formFieldBindings(): Binding[] {
  return [
    ...DIGITS.map(
      (digit, index): Binding => ({
        key: digit,
        help: index === 0 ? 'Answer the focused field' : undefined,
        helpKey: index === 0 ? '0-9' : undefined,
        when: () => activeFormField() !== undefined,
        run: runFormKey,
      })
    ),
    // Tab and Escape are the way back out of a field the previous Enter or a
    // click focused, so they must survive the typing guard - without that the
    // form keys go dead the moment they are used. Tab stays ours even with no
    // fields to cycle: handing it back to the browser walks focus onto the
    // toolbar and panel buttons, which then answer Enter and Space.
    {
      key: 'tab',
      help: 'Cycle form fields',
      allowInInput: true,
      when: formKeysApply,
      run: runFormKey,
    },
    {
      key: 'shift+tab',
      help: 'Cycle form fields backward',
      allowInInput: true,
      when: formKeysApply,
      run: runFormKey,
    },
    {
      key: 'escape',
      help: 'Unfocus the active field',
      allowInInput: true,
      // The comment box is focused by its own 'c' binding and has no other way
      // out, so Escape blurs it too - otherwise every key stays swallowed by
      // the textarea until the user reaches for the mouse.
      when: () => formKeysApply() && (formKeyContext().activeIndex !== null || commentIsFocused()),
      run: (e) => {
        if (commentIsFocused()) commentBox()?.blur();
        runFormKey(e);
      },
    },
    {
      key: 'enter',
      help: 'Focus the active field',
      when: () => {
        const field = activeFormField();
        return field !== undefined && field.type !== 'category' && field.type !== 'multicategory';
      },
      run: runFormKey,
    },
  ];
}

// ---------------------------------------------------------------------------
// Editing saved annotations (Explore only)
// ---------------------------------------------------------------------------

function editBindings(): Binding[] {
  const hasSelection = () => useWorkStore.getState().selection.length > 0;
  const del: Binding = {
    key: 'delete',
    help: 'Delete the selected annotation(s)',
    when: hasSelection,
    run: () => void deleteSelection(),
  };
  return [
    {
      key: 'enter',
      help: 'Save the edited shape',
      when: () => useWorkStore.getState().edit?.pending != null,
      run: () => void commitEdit(),
    },
    {
      key: 'escape',
      help: 'Cancel the edit',
      when: hasSelection,
      run: () => useWorkStore.getState().clearEdit(),
    },
    del,
    { ...del, key: 'backspace', help: undefined },
  ];
}

// ---------------------------------------------------------------------------
// Explore mode
// ---------------------------------------------------------------------------

const TOOL_KEYS: Array<{ key: string; tool: Tool; help: string }> = [
  { key: 'p', tool: 'pan', help: 'Pan tool' },
  { key: 'r', tool: 'annotate', help: 'Annotate tool' },
  { key: 'e', tool: 'edit', help: 'Edit tool' },
  { key: 'b', tool: 'labelVector', help: 'Label vector features' },
  { key: 't', tool: 'timeseries', help: 'Timeseries probe' },
];

function exploreBindings(): Binding[] {
  const { campaign } = campaignState();
  const labels = campaign.settings.labels;
  const hasTimeseries = campaign.time_series.length > 0;
  const hasVectorLayers = (campaign.vector_layers?.length ?? 0) > 0;
  const draftIsOpen = () => useWorkStore.getState().draft.phase === 'draft';

  const toolBinding = ({ key, tool, help }: (typeof TOOL_KEYS)[number]): Binding => ({
    key,
    help,
    when: () => {
      if (tool === 'timeseries') return hasTimeseries;
      if (tool === 'labelVector') return hasVectorLayers;
      return true;
    },
    run: () => void useWorkStore.getState().selectTool(tool),
  });

  // A digit answers the open questions catalog, so label selection only takes
  // digits when nothing is waiting to be saved. Explore has no two-digit
  // buffer, so only digits naming a real label are bound.
  const labelCount = Math.min(labels.length, 9);
  const digitBinding = (index: number): Binding => ({
    key: String(index + 1),
    help: index === 0 ? 'Select label by number' : undefined,
    helpKey: index === 0 ? `1-${labelCount}` : undefined,
    when: () => !draftIsOpen(),
    run: () => {
      const label = labels[index];
      if (label) useWorkStore.getState().selectLabel(label.id);
    },
  });

  return [
    ...TOOL_KEYS.map(toolBinding),
    ...Array.from({ length: labelCount }, (_, i) => digitBinding(i)),
    {
      key: 'f',
      help: 'Flag the selected annotation for review',
      when: () => useWorkStore.getState().edit !== null,
      run: () => {
        const edit = useWorkStore.getState().edit;
        if (!edit) return;
        void useWorkStore
          .getState()
          .saveEditFlag(!edit.annotation.flagged_for_review, edit.annotation.flag_comment ?? null);
      },
    },
    {
      key: 'enter',
      help: 'Save the drawn annotation',
      // Reachable from inside a field too: answering the last question and
      // pressing Enter is how a draft gets finished, without reaching for
      // Escape first.
      allowInInput: true,
      when: () => draftIsOpen() && formKeysApply() && !typingMultiline(),
      run: () => {
        blurFormInput();
        void useWorkStore
          .getState()
          .commitDraft()
          .then((saved) => {
            if (!saved) {
              alert(
                'Could not save the annotation - check the required questions and retry.',
                'error'
              );
            }
          });
      },
    },
    {
      key: 'escape',
      help: (campaign.settings.form_fields ?? []).some((f) => f.required)
        ? 'Close the draft (incomplete answers discard it)'
        : 'Close the questions (the annotation is already saved)',
      when: draftIsOpen,
      run: () => void useWorkStore.getState().closeDraft(),
    },
  ];
}

// ---------------------------------------------------------------------------
// Tasks mode
// ---------------------------------------------------------------------------

const revealConfidence = () =>
  reveal(document.querySelector<HTMLElement>('[data-task-confidence]'));

function adjustConfidence(delta: number): void {
  const work = useWorkStore.getState();
  work.setConfidence(Math.max(1, Math.min(5, (work.confidence ?? DEFAULT_CONFIDENCE) + delta)));
  revealConfidence();
}

function taskBindings(): Binding[] {
  const { campaign, catalog } = campaignState();
  const labels = campaign.settings.labels;

  // Below 10 labels a single keystroke always resolves the selection, so only
  // digits naming a real label are bound. At 10+ every digit can appear in
  // either position.
  const digits =
    labels.length >= 10 ? DIGITS : Array.from({ length: labels.length }, (_, i) => String(i + 1));
  const labelHelp =
    labels.length >= 10 ? 'Select label by number (two digits for 10+)' : 'Select label by number';

  return [
    ...digits.map(
      (digit, index): Binding => ({
        key: digit,
        help: index === 0 ? labelHelp : undefined,
        helpKey: index === 0 ? `${digits[0]}-${digits[digits.length - 1]}` : undefined,
        run: () => handleDigitInput(digit, labels),
      })
    ),
    // Shift+<digit> produces a symbol, and a different one per layout, so
    // matchKey resolves digit specs through `e.code`.
    ...([1, 2, 3, 4, 5] as const).map(
      (level): Binding => ({
        key: `shift+${level}`,
        help: level === 1 ? 'Set confidence level' : undefined,
        helpKey: level === 1 ? 'Shift+1-5' : undefined,
        run: () => {
          useWorkStore.getState().setConfidence(level);
          revealConfidence();
        },
      })
    ),

    { key: 'w', help: 'Previous task', run: () => useTasksStore.getState().previous(catalog) },
    { key: 's', help: 'Next task', run: () => void advance() },
    { key: 'q', help: 'Decrease confidence', run: () => adjustConfidence(-1) },
    { key: 'e', help: 'Increase confidence', run: () => adjustConfidence(1) },
    {
      key: 'c',
      help: 'Focus comment',
      run: () => revealAndFocus(document.querySelector('[data-task-comment]'), commentBox()),
    },
    {
      key: 'f',
      help: 'Toggle flag for review',
      run: () => {
        const work = useWorkStore.getState();
        work.setFlagged(!work.flagged);
      },
    },
    {
      key: 'enter',
      help: 'Submit',
      run: () => {
        void submitAnnotation().catch((error) =>
          handleError(error, 'Could not submit the annotation')
        );
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Map navigation, available in both modes
// ---------------------------------------------------------------------------

function mapBindings(): Binding[] {
  const { campaign, catalog, view, workMode } = campaignState();
  const views = campaign.imagery_views;
  const imagery = () => useImageryStore.getState();

  const cycleSource = (dir: 1 | -1) => {
    if (!view) return;
    rememberLastAddress(imagery().address);
    imagery().cycleSourceAction(catalog, view, dir, lastBySource);
  };

  const cycleView = () => {
    if (views.length <= 1) return;
    const { view: current, selectView } = useCampaignStore.getState();
    const index = views.findIndex((v) => v.id === current?.id);
    const next = views[(index + 1) % views.length];
    selectView(next);
  };

  const overlays = () => readyCustomMaps([...catalog.customMaps.values()]);
  const vectorLayers = () => [...catalog.vectorLayers.values()];
  const hasVectorLayers = () => catalog.vectorLayers.size > 0;

  /** Steps once, then keeps stepping while the key is held. */
  const scrub = (key: string, help: string, step: () => void): Binding => ({
    key,
    help,
    run: () => {
      step();
      startAutoNav(step);
    },
  });

  // Explore registers 't' with its tool palette; this is the Tasks half, and
  // binding both would list the key twice in the help.
  const probeTool: Binding[] =
    workMode === 'tasks' && campaign.time_series.length > 0
      ? [
          {
            key: 't',
            help: 'Timeseries probe tool - then click the map to move the probe',
            run: () => useWorkStore.getState().toggleProbeTool(),
          },
        ]
      : [];

  // Both modes: the tool moves the probe you picked up, so adding another is
  // its own key rather than a different kind of click.
  const addProbe: Binding[] =
    campaign.time_series.length > 0
      ? [
          {
            key: 'shift+t',
            help: 'Add another timeseries probe',
            run: () => useWorkStore.getState().armAddProbe(true),
          },
        ]
      : [];

  return [
    ...addProbe,
    scrub('a', 'Previous slice', () => imagery().stepSliceAction(catalog, -1)),
    scrub('d', 'Next slice', () => imagery().stepSliceAction(catalog, 1)),
    scrub('shift+a', 'Previous collection', () => imagery().stepCollectionAction(catalog, -1)),
    scrub('shift+d', 'Next collection', () => imagery().stepCollectionAction(catalog, 1)),

    { key: 'i', help: 'Cycle imagery source', run: () => cycleSource(1) },
    {
      key: 'shift+i',
      help: 'Cycle visualization',
      run: () => imagery().cycleVizAction(catalog, 1),
    },

    {
      key: 'o',
      help: 'Toggle overlay layer',
      run: () => imagery().overlayAction(overlays(), 'toggle'),
    },
    {
      key: 'shift+o',
      help: 'Cycle overlay layers',
      run: () => imagery().overlayAction(overlays(), 'cycle'),
    },

    {
      key: 'v',
      help: 'Toggle vector layer',
      when: hasVectorLayers,
      run: () => imagery().vectorAction(vectorLayers(), 'toggle'),
    },
    {
      key: 'shift+v',
      help: 'Cycle vector layers',
      when: hasVectorLayers,
      run: () => imagery().vectorAction(vectorLayers(), 'cycle'),
    },

    ...probeTool,

    { key: 'u', help: 'Cycle view', run: cycleView },
    {
      // Both modes, one key: switching is the same idea from either side.
      key: 'm',
      help: workMode === 'tasks' ? 'Switch to Explore' : 'Switch to Tasks',
      when: () => canEnterMode(workMode === 'tasks' ? 'explore' : 'tasks'),
      run: () => void switchWorkMode(workMode === 'tasks' ? 'explore' : 'tasks'),
    },
    {
      key: 'l',
      help: 'Toggle view link (sync imagery panels)',
      run: () => imagery().toggleViewSync(),
    },
    {
      key: 'shift+c',
      help: 'Comment on the imagery the main map is showing',
      run: () => {
        const { address } = imagery();
        if (address) useWorkStore.getState().openSliceComment(address);
      },
    },

    { key: 'x', help: 'Toggle crosshair', run: () => imagery().toggleCrosshair() },
    { key: 'shift+x', help: 'Toggle drawn objects', run: () => imagery().toggleAnnotations() },

    { key: 'arrowup', help: 'Pan map up', allowRepeat: true, run: () => pan('up') },
    { key: 'arrowdown', help: 'Pan map down', allowRepeat: true, run: () => pan('down') },
    { key: 'arrowleft', help: 'Pan map left', allowRepeat: true, run: () => pan('left') },
    { key: 'arrowright', help: 'Pan map right', allowRepeat: true, run: () => pan('right') },
    { key: 'alt+arrowup', help: 'Zoom in', allowRepeat: true, run: () => zoom(1) },
    { key: 'alt+arrowdown', help: 'Zoom out', allowRepeat: true, run: () => zoom(-1) },

    {
      key: ' ',
      // One key, two meanings, so the help carries both rather than a panel
      // keeping a second copy of the rule.
      help: 'Recenter map on the task (tasks) / fit to all annotations (explore)',
      run: () => {
        if (workMode === 'tasks') {
          const focus = useTasksStore.getState().focus;
          if (!focus) return;
          mainCamera.moveTo({ center: focus.center });
          // The overview is the user's to pan in task mode, so recentring is
          // also how it gets back to the pin.
          minimapCamera.moveTo(tasksModeTarget(focus.center));
        } else {
          void fitAnnotations(catalog.campaignId, imagery().showTaskAnnotations);
        }
      },
    },
  ];
}

// ---------------------------------------------------------------------------

/**
 * Every shortcut in the workspace, most specific first: the first binding
 * whose key matches and whose `when` passes runs. That ordering is what lets
 * Escape mean "cancel the edit" while editing, "close the draft" while
 * drafting, and "leave the field" while a field is focused, with no scope
 * machinery behind it.
 *
 * Rebuilt whenever the campaign, view or mode changes; the closures above read
 * live store state so nothing here goes stale between rebuilds.
 */
const tag = (table: Binding[], group: Binding['group']): Binding[] =>
  table.map((b) => ({ ...b, group }));

/**
 * Change work style, from the toolbar or the keyboard.
 *
 * Both modes answer the same work-store form, so an Explore draft left open
 * would go on collecting the task form's answers and write them onto a shape
 * drawn in the other mode. Closing it is Escape's own disposition - complete
 * saves, incomplete discards - and a save that fails parks the draft for a
 * retry only Explore can offer, so the switch is called off and said out loud.
 */
export async function switchWorkMode(mode: WorkMode): Promise<void> {
  const { workMode } = campaignState();
  if (mode === workMode) return;

  const outcome = await useWorkStore.getState().closeDraft();
  if (outcome === 'save-failed') {
    useGlobalLayoutStore
      .getState()
      .showAlert(
        'Could not save the open annotation - it is still here, retry before switching.',
        'error'
      );
    return;
  }
  useCampaignStore.getState().setWorkMode(mode);
}

/** Tasks needs tasks to work through; Explore needs the campaign to allow it. */
export function canEnterMode(mode: WorkMode): boolean {
  const { campaign } = campaignState();
  if (mode === 'tasks') return useTasksStore.getState().allTasks.length > 0;
  const { currentUserId } = useCampaignStore.getState();
  return isAudienceMember(
    campaign.settings.labelling_policy.explore,
    toPolicyContext(campaign, currentUserId)
  );
}

export function pageKeymap(): Binding[] {
  const { workMode, isMobile } = campaignState();
  // Drawing is Explore's map behaviour, and the one surface that edits data by
  // pointer - mobile gets the read-only canvas instead.
  const editing = workMode === 'explore' && !isMobile ? editBindings() : [];
  const mode = workMode === 'tasks' ? taskBindings() : exploreBindings();
  return [
    ...tag(editing, 'edit'),
    ...tag(formFieldBindings(), 'form'),
    ...tag(mode, 'mode'),
    ...tag(mapBindings(), 'map'),
  ];
}

export { skipCurrent, submitAnnotation, submitAuthoritative };
