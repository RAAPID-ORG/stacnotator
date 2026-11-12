import type {
  AnnotationFromTaskOut,
  TaskOut,
  TaskSummaryAnswers,
  TaskSummaryAssignments,
  TaskSummaryOut,
  TaskSummaryTasks,
} from '~/api/client';
import { getCenter } from 'ol/extent';
import WKT from 'ol/format/WKT';

/**
 * One task of a campaign's task summary, as the pages that hold every task read it.
 *
 * The summary arrives columnar (one array per field, people by position in a lookup),
 * which is what keeps it small for campaigns of tens of thousands of tasks; this is it
 * turned back into one object per task. Field names follow `TaskOut`, so code that
 * only reads summary fields works on either. What only one task's view needs (its
 * geometry, form values, slice notes) comes from `getTaskDetails`.
 */
export interface TaskRow {
  id: number;
  annotation_number: number;
  task_set_id: number;
  task_status: TaskSummaryTasks['task_status'][number];
  claimed_by_user_id: string | null;
  claimed_at: string | null;
  claimed_by_display_name: string | null;
  /** The task geometry's centroid. */
  lon: number;
  lat: number;
  nearby_annotation_count: number;
  drawn_by_user_ids: string[];
  assignments: TaskRowAssignment[];
  annotations: TaskRowAnswer[];
}

export interface TaskRowAssignment {
  user_id: string;
  status: TaskSummaryAssignments['status'][number];
  user_display_name: string;
  user_email: string | null;
}

export interface TaskRowAnswer {
  id: number;
  created_by_user_id: string;
  created_by_user_display_name: string;
  created_by_user_email: string | null;
  label_id: number | null;
  outcome: TaskSummaryAnswers['outcome'][number];
  confidence: number | null;
  flagged_for_review: boolean;
  active_seconds: number | null;
  is_authoritative: boolean;
  counts_toward_completion: boolean;
  comment: string | null;
  flag_comment: string | null;
  /** Changes with any edit, form values and slice notes included. */
  updated_at: string;
  /** Form fields answered with a non-empty value, by field id. */
  answered_field_ids: string[];
}

export function decodeTaskSummary(summary: TaskSummaryOut): TaskRow[] {
  const { users, tasks, assignments, answers } = summary;
  const rows: TaskRow[] = tasks.id.map((id, i) => {
    const claimer = tasks.claimed_by[i];
    return {
      id,
      annotation_number: tasks.annotation_number[i],
      task_set_id: tasks.task_set_id[i],
      task_status: tasks.task_status[i],
      claimed_by_user_id: claimer === null ? null : users.id[claimer],
      claimed_at: tasks.claimed_at[i],
      claimed_by_display_name: claimer === null ? null : users.display_name[claimer],
      lon: tasks.lon[i],
      lat: tasks.lat[i],
      nearby_annotation_count: tasks.nearby_annotation_count[i],
      drawn_by_user_ids: tasks.drawn_by[i].map((u) => users.id[u]),
      assignments: [],
      annotations: [],
    };
  });
  assignments.task.forEach((task, i) => {
    const user = assignments.user[i];
    rows[task].assignments.push({
      user_id: users.id[user],
      status: assignments.status[i],
      user_display_name: users.display_name[user],
      user_email: users.email[user],
    });
  });
  answers.task.forEach((task, i) => {
    const user = answers.user[i];
    rows[task].annotations.push({
      id: answers.id[i],
      created_by_user_id: users.id[user],
      created_by_user_display_name: users.display_name[user],
      created_by_user_email: users.email[user],
      label_id: answers.label_id[i],
      outcome: answers.outcome[i],
      confidence: answers.confidence[i],
      flagged_for_review: answers.flagged_for_review[i],
      active_seconds: answers.active_seconds[i],
      is_authoritative: answers.is_authoritative[i],
      counts_toward_completion: answers.counts_toward_completion[i],
      comment: answers.comment[i],
      flag_comment: answers.flag_comment[i],
      updated_at: answers.updated_at[i],
      answered_field_ids: answers.answered_field_ids[i],
    });
  });
  return rows;
}

const isAnswered = (value: unknown) =>
  value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);

/** One answer as the summary carries it, from a full one. */
export function taskRowAnswer(answer: AnnotationFromTaskOut): TaskRowAnswer {
  return {
    id: answer.id,
    created_by_user_id: answer.created_by_user_id,
    created_by_user_display_name: answer.created_by_user_display_name ?? '',
    created_by_user_email: answer.created_by_user_email ?? null,
    label_id: answer.label_id,
    outcome: answer.outcome ?? 'labelled',
    confidence: answer.confidence,
    flagged_for_review: answer.flagged_for_review,
    active_seconds: answer.active_seconds ?? null,
    is_authoritative: answer.is_authoritative,
    counts_toward_completion: answer.counts_toward_completion ?? true,
    comment: answer.comment,
    flag_comment: answer.flag_comment,
    updated_at: answer.updated_at,
    answered_field_ids: Object.entries(answer.form_values ?? {})
      .filter(([, value]) => isAnswered(value))
      .map(([id]) => id)
      .sort(),
  };
}

const wkt = new WKT();

/** A task the server returned in full (a claim, its details) as a summary row. Its
 *  centre is the geometry's bounding-box centre until a summary brings the centroid. */
export function taskRowFromTaskOut(task: TaskOut): TaskRow {
  const [lon, lat] = getCenter(wkt.readGeometry(task.geometry_wkt).getExtent());
  return {
    id: task.id,
    annotation_number: task.annotation_number,
    task_set_id: task.task_set_id,
    task_status: task.task_status,
    claimed_by_user_id: task.claimed_by_user_id ?? null,
    claimed_at: task.claimed_at ?? null,
    claimed_by_display_name: task.claimed_by_display_name ?? null,
    lon,
    lat,
    nearby_annotation_count: task.nearby_annotation_count ?? 0,
    drawn_by_user_ids: task.drawn_by_user_ids ?? [],
    assignments: task.assignments.map((a) => ({
      user_id: a.user_id,
      status: a.status,
      user_display_name: a.user_display_name ?? '',
      user_email: a.user_email ?? null,
    })),
    annotations: task.annotations.map(taskRowAnswer),
  };
}
