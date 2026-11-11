"""A campaign's task summary, built as JSON by Postgres.

The task list a page holds for every task of a campaign - status, claim, assignees,
answers - for campaigns of tens of thousands of tasks. Python touches no row: the
statement joins, applies the status rule (STATUS_SQL), shapes the columnar
TaskSummaryOut and hands back the bytes. Python supplies only what the rules need per
author, which is a handful of people however many tasks there are.
"""

from collections.abc import Collection
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from src.annotation.models import Annotation
from src.campaigns.models import Campaign
from src.tasks.completion import completion_by_author
from src.tasks.status import STATUS_SQL

_SUMMARY_SQL = (
    """
WITH scope AS (
    SELECT id, annotation_number, task_set_id, claimed_by_user_id, claimed_at,
           round(CAST(ST_X(ST_Centroid(geometry)) AS numeric), 6) AS lon,
           round(CAST(ST_Y(ST_Centroid(geometry)) AS numeric), 6) AS lat,
           row_number() OVER (ORDER BY annotation_number) - 1 AS i
    FROM data.tasks
    WHERE campaign_id = :campaign_id
      AND (CAST(:task_ids AS int[]) IS NULL OR id = ANY(CAST(:task_ids AS int[])))
),
status_assignments AS (
    SELECT ta.task_id, ta.user_id, ta.is_review
    FROM data.task_assignments ta JOIN scope ON scope.id = ta.task_id
),
raw_answers AS (
    SELECT a.task_id, a.id, a.created_by_user_id, a.label_id, a.outcome, a.confidence,
           a.flagged_for_review, a.active_seconds, a.is_authoritative, a.comment,
           a.flag_comment, a.form_values, a.updated_at
    FROM data.annotations a JOIN scope ON scope.id = a.task_id
),
completion AS (
    SELECT * FROM unnest(CAST(:authors AS uuid[]), CAST(:on_unassigned_task AS bool[]),
                         CAST(:when_assigned AS bool[]), CAST(:when_not_assigned AS bool[]))
        AS c(user_id, on_unassigned_task, when_assigned, when_not_assigned)
),
assigned_tasks AS (SELECT DISTINCT task_id FROM status_assignments),
status_answers AS (
    SELECT r.task_id, r.created_by_user_id AS user_id,
           CASE r.outcome WHEN 'labelled' THEN CAST(r.label_id AS text)
                          WHEN 'skipped' THEN NULL ELSE r.outcome END AS answer,
           r.is_authoritative,
           CASE WHEN t.task_id IS NULL THEN c.on_unassigned_task
                WHEN s.user_id IS NOT NULL THEN c.when_assigned
                ELSE c.when_not_assigned END AS counts
    FROM raw_answers r
    LEFT JOIN assigned_tasks t ON t.task_id = r.task_id
    LEFT JOIN status_assignments s ON s.task_id = r.task_id AND s.user_id = r.created_by_user_id
    LEFT JOIN completion c ON c.user_id = r.created_by_user_id
),
"""  # noqa: S608 - joins constants; every value is a bound parameter
    + STATUS_SQL
    + """,
drawn AS (
    SELECT DISTINCT a.output_of_task_id AS task_id, a.created_by_user_id AS user_id
    FROM data.annotations a JOIN scope ON scope.id = a.output_of_task_id
),
nearby AS (
    SELECT a.origin_task_id AS task_id, count(*) AS n
    FROM data.annotations a JOIN scope ON scope.id = a.origin_task_id
    GROUP BY a.origin_task_id
),
people AS (
    SELECT user_id, row_number() OVER (ORDER BY user_id) - 1 AS u FROM (
        SELECT DISTINCT user_id FROM status_assignments
        UNION SELECT DISTINCT user_id FROM status_answers
        UNION SELECT DISTINCT user_id FROM drawn
        UNION SELECT DISTINCT claimed_by_user_id FROM scope WHERE claimed_by_user_id IS NOT NULL
    ) x
),
drawn_by AS (
    SELECT d.task_id, json_agg(p.u ORDER BY p.u) AS users
    FROM drawn d JOIN people p ON p.user_id = d.user_id GROUP BY d.task_id
),
user_cols AS (
    SELECT json_build_object(
        'id', coalesce(json_agg(p.user_id ORDER BY p.u), '[]'),
        'display_name', coalesce(json_agg(coalesce(u.display_name, split_part(u.email, '@', 1))
                                          ORDER BY p.u), '[]'),
        'email', coalesce(json_agg(CASE WHEN :with_email THEN u.email END ORDER BY p.u), '[]')
    ) AS j
    FROM people p LEFT JOIN auth.users u ON u.id = p.user_id
),
task_cols AS (
    SELECT json_build_object(
        'id', coalesce(json_agg(t.id ORDER BY t.i), '[]'),
        'annotation_number', coalesce(json_agg(t.annotation_number ORDER BY t.i), '[]'),
        'task_set_id', coalesce(json_agg(t.task_set_id ORDER BY t.i), '[]'),
        'task_status', coalesce(json_agg(coalesce(st.status, 'pending') ORDER BY t.i), '[]'),
        'claimed_by', coalesce(json_agg(p.u ORDER BY t.i), '[]'),
        'claimed_at', coalesce(json_agg(t.claimed_at ORDER BY t.i), '[]'),
        'lon', coalesce(json_agg(t.lon ORDER BY t.i), '[]'),
        'lat', coalesce(json_agg(t.lat ORDER BY t.i), '[]'),
        'nearby_annotation_count', coalesce(json_agg(coalesce(n.n, 0) ORDER BY t.i), '[]'),
        'drawn_by', coalesce(json_agg(coalesce(d.users, '[]') ORDER BY t.i), '[]')
    ) AS j
    FROM scope t
    LEFT JOIN task_statuses st ON st.task_id = t.id
    LEFT JOIN people p ON p.user_id = t.claimed_by_user_id
    LEFT JOIN nearby n ON n.task_id = t.id
    LEFT JOIN drawn_by d ON d.task_id = t.id
),
assignment_cols AS (
    SELECT json_build_object(
        'task', coalesce(json_agg(t.i ORDER BY t.i, p.u), '[]'),
        'user', coalesce(json_agg(p.u ORDER BY t.i, p.u), '[]'),
        'status', coalesce(json_agg(a.status ORDER BY t.i, p.u), '[]')
    ) AS j
    FROM assignee_statuses a
    JOIN scope t ON t.id = a.task_id
    JOIN people p ON p.user_id = a.user_id
),
answer_cols AS (
    SELECT json_build_object(
        'id', coalesce(json_agg(r.id ORDER BY r.id), '[]'),
        'task', coalesce(json_agg(t.i ORDER BY r.id), '[]'),
        'user', coalesce(json_agg(p.u ORDER BY r.id), '[]'),
        'label_id', coalesce(json_agg(r.label_id ORDER BY r.id), '[]'),
        'outcome', coalesce(json_agg(r.outcome ORDER BY r.id), '[]'),
        'confidence', coalesce(json_agg(r.confidence ORDER BY r.id), '[]'),
        'flagged_for_review', coalesce(json_agg(r.flagged_for_review ORDER BY r.id), '[]'),
        'active_seconds', coalesce(json_agg(r.active_seconds ORDER BY r.id), '[]'),
        'is_authoritative', coalesce(json_agg(r.is_authoritative ORDER BY r.id), '[]'),
        'counts_toward_completion', coalesce(json_agg(s.counts ORDER BY r.id), '[]'),
        'comment', coalesce(json_agg(r.comment ORDER BY r.id), '[]'),
        'flag_comment', coalesce(json_agg(r.flag_comment ORDER BY r.id), '[]'),
        'updated_at', coalesce(json_agg(r.updated_at ORDER BY r.id), '[]'),
        -- form_values can be SQL NULL or a JSON null, so only objects are looked into.
        'answered_field_ids', coalesce(json_agg(coalesce(
            CASE WHEN jsonb_typeof(r.form_values) = 'object' THEN
                (SELECT json_agg(f.key ORDER BY f.key) FROM jsonb_each(r.form_values) f
                 WHERE f.value NOT IN ('null', '""', '[]'))
            END,
            '[]') ORDER BY r.id), '[]')
    ) AS j
    FROM raw_answers r
    JOIN scope t ON t.id = r.task_id
    JOIN status_answers s ON s.task_id = r.task_id AND s.user_id = r.created_by_user_id
    JOIN people p ON p.user_id = r.created_by_user_id
)
SELECT CAST(json_build_object(
    'campaign_id', CAST(:campaign_id AS int),
    'server_time', now(),
    'users', (SELECT j FROM user_cols),
    'tasks', (SELECT j FROM task_cols),
    'assignments', (SELECT j FROM assignment_cols),
    'answers', (SELECT j FROM answer_cols)
) AS text),
(SELECT array_agg(DISTINCT CAST(r.created_by_user_id AS text)) FROM raw_answers r
 WHERE NOT EXISTS (SELECT 1 FROM completion c WHERE c.user_id = r.created_by_user_id))
"""
)


def task_summary_json(
    db: Session,
    campaign: Campaign,
    task_ids: Collection[int] | None = None,
    *,
    with_email: bool,
) -> bytes:
    """The TaskSummaryOut of a campaign's tasks, or of ``task_ids`` only, as JSON."""
    authored = select(Annotation.created_by_user_id).where(
        Annotation.campaign_id == campaign.id, Annotation.task_id.is_not(None)
    )
    if task_ids is not None:
        authored = authored.where(Annotation.task_id.in_(list(task_ids)))
    authors = set(db.scalars(authored.distinct()))
    # The planner cannot see through the CTEs and estimates far more rows than there
    # are, which makes JIT compilation look worth it: it cost more than the query.
    db.execute(text("SET LOCAL jit = off"))
    # An author's first answer can commit between the lookup above and the statement,
    # which then has no rule for them; the statement names such authors, and one more
    # pass with them included settles it.
    for _ in range(3):
        completion = completion_by_author(db, campaign, authors)
        ordered = sorted(authors)
        body, unknown = db.execute(
            text(_SUMMARY_SQL),
            {
                "campaign_id": campaign.id,
                "task_ids": list(task_ids) if task_ids is not None else None,
                "with_email": with_email,
                "authors": [str(a) for a in ordered],
                "on_unassigned_task": [completion[a].on_unassigned_task for a in ordered],
                "when_assigned": [completion[a].when_assigned for a in ordered],
                "when_not_assigned": [completion[a].when_not_assigned for a in ordered],
            },
        ).one()
        if not unknown:
            break
        authors |= {UUID(a) for a in unknown}
    result: str = body
    return result.encode()
