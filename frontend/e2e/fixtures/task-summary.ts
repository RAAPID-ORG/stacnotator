import type { Page } from '@playwright/test';

/** A full task list as the specs describe it: TaskOut-shaped mocks. */
export interface MockTaskList {
  campaign_id: number;
  tasks: any[];
}

const isAnswered = (value: unknown) =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  !(Array.isArray(value) && value.length === 0);

/** The centre of a WKT geometry's bounding box: what the mocks need for a centroid. */
function centre(wkt: string): [number, number] {
  const numbers = (wkt.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const lons = numbers.filter((_, i) => i % 2 === 0);
  const lats = numbers.filter((_, i) => i % 2 === 1);
  return [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}

/** The columnar GET /tasks/summary body the server would send for these tasks. */
export function toTaskSummary(list: MockTaskList, serverTime = '2024-01-01T00:00:00Z') {
  const people = new Map<string, { name: string; email: string | null }>();
  const person = (id: string, name?: string | null, email?: string | null) => {
    if (!people.has(id)) people.set(id, { name: name ?? id, email: email ?? null });
    return [...people.keys()].indexOf(id);
  };
  const tasks = list.tasks;
  const columns = {
    tasks: {
      id: tasks.map((t) => t.id),
      annotation_number: tasks.map((t) => t.annotation_number),
      task_set_id: tasks.map((t) => t.task_set_id),
      task_status: tasks.map((t) => t.task_status),
      claimed_by: tasks.map((t) =>
        t.claimed_by_user_id ? person(t.claimed_by_user_id, t.claimed_by_display_name) : null
      ),
      claimed_at: tasks.map((t) => t.claimed_at ?? null),
      lon: tasks.map((t) => centre(t.geometry_wkt)[0]),
      lat: tasks.map((t) => centre(t.geometry_wkt)[1]),
      nearby_annotation_count: tasks.map((t) => t.nearby_annotation_count ?? 0),
      drawn_by: tasks.map((t) => (t.drawn_by_user_ids ?? []).map((id: string) => person(id))),
    },
    assignments: { task: [] as number[], user: [] as number[], status: [] as string[] },
    answers: {
      id: [] as number[],
      task: [] as number[],
      user: [] as number[],
      label_id: [] as (number | null)[],
      outcome: [] as string[],
      confidence: [] as (number | null)[],
      flagged_for_review: [] as boolean[],
      active_seconds: [] as (number | null)[],
      is_authoritative: [] as boolean[],
      counts_toward_completion: [] as boolean[],
      comment: [] as (string | null)[],
      flag_comment: [] as (string | null)[],
      updated_at: [] as string[],
      answered_field_ids: [] as string[][],
    },
  };
  tasks.forEach((t, i) => {
    for (const a of t.assignments ?? []) {
      columns.assignments.task.push(i);
      columns.assignments.user.push(person(a.user_id, a.user_display_name, a.user_email));
      columns.assignments.status.push(a.status);
    }
    for (const a of t.annotations ?? []) {
      const n = columns.answers;
      n.id.push(a.id);
      n.task.push(i);
      n.user.push(
        person(a.created_by_user_id, a.created_by_user_display_name, a.created_by_user_email)
      );
      n.label_id.push(a.label_id ?? null);
      n.outcome.push(a.outcome ?? 'labelled');
      n.confidence.push(a.confidence ?? null);
      n.flagged_for_review.push(a.flagged_for_review ?? false);
      n.active_seconds.push(a.active_seconds ?? null);
      n.is_authoritative.push(a.is_authoritative ?? false);
      n.counts_toward_completion.push(a.counts_toward_completion ?? true);
      n.comment.push(a.comment ?? null);
      n.flag_comment.push(a.flag_comment ?? null);
      n.updated_at.push(a.updated_at ?? '2024-01-01T00:00:00Z');
      n.answered_field_ids.push(
        Object.entries(a.form_values ?? {})
          .filter(([, value]) => isAnswered(value))
          .map(([id]) => id)
          .sort()
      );
    }
  });
  return {
    campaign_id: list.campaign_id,
    server_time: serverTime,
    users: {
      id: [...people.keys()],
      display_name: [...people.values()].map((p) => p.name),
      email: [...people.values()].map((p) => p.email),
    },
    ...columns,
  };
}

/**
 * Serve a task list the way the server now does: the summary (nothing changed on a
 * `since` poll) and the full details of the tasks a view asks for. `list` is read on
 * every request, so a spec can change it mid-flight.
 */
export async function routeTaskList(page: Page, list: () => MockTaskList): Promise<void> {
  await page.route('**/api/campaigns/*/tasks/summary*', async (route) => {
    const since = new URL(route.request().url()).searchParams.get('since');
    const current = list();
    await route.fulfill({
      json: toTaskSummary(since ? { ...current, tasks: [] } : current),
    });
  });
  await page.route('**/api/campaigns/*/tasks/details*', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const current = list();
    const ids = new Set(params.getAll('ids').map(Number));
    const first = params.get('first');
    const tasks = first
      ? [...current.tasks]
          .sort((a, b) => a.annotation_number - b.annotation_number)
          .slice(0, Number(first))
      : current.tasks.filter((t) => ids.has(t.id));
    await route.fulfill({ json: { campaign_id: current.campaign_id, tasks } });
  });
}
