import { TASK_SECTION_PREFIX } from '../../canvas/grid';

/** The parts of the task panel that can be moved into panels of their own,
 *  in the order the panel shows them, each with the grid size it starts at. */
export const TASK_SECTIONS = [
  { id: `${TASK_SECTION_PREFIX}fields`, title: 'Form fields', size: { w: 12, h: 10 } },
  { id: `${TASK_SECTION_PREFIX}comment`, title: 'Comment', size: { w: 12, h: 7 } },
  { id: `${TASK_SECTION_PREFIX}submit`, title: 'Confidence & submit', size: { w: 12, h: 10 } },
  { id: `${TASK_SECTION_PREFIX}points`, title: 'Point navigation', size: { w: 12, h: 5 } },
] as const;

/** The sections a campaign has: form fields only when it defines any. */
export function taskSectionsFor(hasFields: boolean) {
  return TASK_SECTIONS.filter((section) => hasFields || section.id !== 'task:fields');
}

export type TaskSectionId = (typeof TASK_SECTIONS)[number]['id'];

export const sectionHeaderClass = (active = false) =>
  `text-[11px] font-medium uppercase tracking-wider ${
    active ? 'text-brand-700' : 'text-neutral-500'
  }`;

/** Lays out the sections the task panel or a section panel holds: one per
 *  row when narrow, as many equal-height cells across as fit when wide. Cells
 *  draw their own right and bottom rules; the grid hangs a pixel past the edge
 *  so the outer column's rule is clipped away. */
export const sectionGridClass =
  '-mr-px grid grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))] content-start';

export const sectionCellClass = 'flex flex-col p-3 border-r border-b border-neutral-100';
