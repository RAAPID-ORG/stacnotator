"""A campaign's task summary, built as JSON by Postgres.

The task list a page holds for every task of a campaign - status, claim, assignees,
answers - for campaigns of tens of thousands of tasks. Python touches no row: the
statement joins, applies the status rule (STATUS_SQL), shapes the columnar
TaskSummaryOut and hands back the bytes. Python supplies only what the rules need per
author, which is a handful of people however many tasks there are.
"""

from collections.abc import Collection, Sequence
from uuid import UUID

from sqlalchemy import Row, select, text
from sqlalchemy.orm import Session

from src.annotation.models import Annotation
from src.campaigns.models import Campaign
from src.campaigns.policy import get_labelling_policy, load_standing
from src.projects.models import Project
from src.tasks.completion import author_completion
from src.tasks.schemas import CampaignProgressOut, TaskProgressOut
from src.tasks.status import STATUS_SQL

_STATUS_INPUTS_SQL = (
    """
status_assignments AS (
    SELECT ta.task_id, ta.user_id, ta.is_review
    FROM data.task_assignments ta JOIN scope ON scope.id = ta.task_id
),
raw_answers AS (
    SELECT a.campaign_id, a.task_id, a.id, a.created_by_user_id, a.label_id, a.outcome, a.confidence,
           a.flagged_for_review, a.active_seconds, a.is_authoritative, a.comment,
           a.flag_comment, a.form_values, a.updated_at
    FROM data.annotations a JOIN scope ON scope.id = a.task_id
),
completion AS (
    SELECT * FROM unnest(CAST(:author_campaigns AS int[]), CAST(:authors AS uuid[]),
                         CAST(:on_unassigned_task AS bool[]),
                         CAST(:when_assigned AS bool[]), CAST(:when_not_assigned AS bool[]))
        AS c(campaign_id, user_id, on_unassigned_task, when_assigned, when_not_assigned)
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
    LEFT JOIN completion c ON c.user_id = r.created_by_user_id AND c.campaign_id = r.campaign_id
),
"""  # noqa: S608 - joins constants; every value is a bound parameter
    + STATUS_SQL
)

_UNKNOWN_AUTHORS_SQL = """
EXISTS (SELECT 1 FROM raw_answers r WHERE NOT EXISTS (
    SELECT 1 FROM completion c
    WHERE c.campaign_id = r.campaign_id AND c.user_id = r.created_by_user_id
))
"""

_PROGRESS_TOTALS_SQL = (
    _STATUS_INPUTS_SQL
    + """
SELECT b.id,
       count(t.id) AS num_tasks,
       count(*) FILTER (WHERE st.status = 'done') AS num_done,
       count(*) FILTER (WHERE st.status = 'conflicting') AS num_conflicting,
       count(mine.task_id) AS num_assigned,
       count(*) FILTER (WHERE mine.status = 'done') AS num_assigned_done,
"""
    + _UNKNOWN_AUTHORS_SQL
    + """
AS missing_rules
FROM buckets b
LEFT JOIN scope t ON t.bucket_id = b.id
LEFT JOIN task_statuses st ON st.task_id = t.id
LEFT JOIN assignee_statuses mine
    ON mine.task_id = t.id AND mine.user_id = CAST(:viewer_id AS uuid)
GROUP BY b.id
"""
)

_TASK_SET_PROGRESS_SQL = (
    """
WITH buckets AS (SELECT id FROM data.task_sets WHERE campaign_id = :campaign_id),
scope AS (SELECT id, task_set_id AS bucket_id FROM data.tasks WHERE campaign_id = :campaign_id),
"""  # noqa: S608 - joins constants only
    + _PROGRESS_TOTALS_SQL
)

_PROJECT_PROGRESS_SQL = (
    """
WITH buckets AS (SELECT unnest(CAST(:campaign_ids AS int[])) AS id),
scope AS (
    SELECT id, campaign_id AS bucket_id FROM data.tasks WHERE campaign_id = ANY(:campaign_ids)
),
"""  # noqa: S608 - joins constants only
    + _PROGRESS_TOTALS_SQL
)

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
"""  # noqa: S608 - only SQL constants are joined; values are bound
    + _STATUS_INPUTS_SQL
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
"""
    + _UNKNOWN_AUTHORS_SQL
)


def task_summary_json(
    db: Session,
    campaign: Campaign,
    task_ids: Collection[int] | None = None,
    *,
    with_email: bool,
) -> bytes:
    body: str = _execute(
        db,
        campaign.project,
        [campaign],
        _SUMMARY_SQL,
        task_ids,
        campaign_id=campaign.id,
        with_email=with_email,
    )[0][0]
    return body.encode()


def task_set_progress(
    db: Session, campaign: Campaign, viewer_id: UUID
) -> dict[int, TaskProgressOut]:
    """Progress of each task set: tasks done by the status rule, and the viewer's own
    assignments (review ones included) they answered."""
    rows = _execute(
        db,
        campaign.project,
        [campaign],
        _TASK_SET_PROGRESS_SQL,
        campaign_id=campaign.id,
        viewer_id=viewer_id,
    )
    return {row.id: TaskProgressOut.model_validate(row, from_attributes=True) for row in rows}


def project_progress(
    db: Session, project: Project, campaigns: Sequence[Campaign], viewer_id: UUID
) -> list[CampaignProgressOut]:
    if not campaigns:
        return []
    rows = _execute(db, project, campaigns, _PROJECT_PROGRESS_SQL, viewer_id=viewer_id)
    return [CampaignProgressOut(campaign_id=row.id, **row._mapping) for row in rows]


def _execute(
    db: Session,
    project: Project,
    campaigns: Sequence[Campaign],
    statement: str,
    task_ids: Collection[int] | None = None,
    *,
    campaign_id: int | None = None,
    with_email: bool = False,
    viewer_id: UUID | None = None,
) -> Sequence[Row]:
    policies = {c.id: get_labelling_policy(c) for c in campaigns}
    authored = select(Annotation.campaign_id, Annotation.created_by_user_id).where(
        Annotation.campaign_id.in_(policies.keys()), Annotation.task_id.is_not(None)
    )
    if task_ids is not None:
        authored = authored.where(Annotation.task_id.in_(list(task_ids)))
    # The planner cannot see through the CTEs and estimates far more rows than there
    # are, which makes JIT compilation look worth it: it cost more than the query.
    db.execute(text("SET LOCAL jit = off"))
    # An author's first answer can commit between the lookup above and the statement,
    # which then has no rule for them; retry with fresh campaign/author pairs.
    while True:
        pairs = db.execute(authored.distinct()).tuples().all()
        standing = load_standing(db, project, (author for _, author in pairs))
        cases = [author_completion(policies[cid], standing, author) for cid, author in pairs]
        rows = db.execute(
            text(statement),
            {
                "campaign_id": campaign_id,
                "campaign_ids": list(policies),
                "task_ids": list(task_ids) if task_ids is not None else None,
                "with_email": with_email,
                "viewer_id": str(viewer_id) if viewer_id else None,
                "author_campaigns": [cid for cid, _ in pairs],
                "authors": [str(author) for _, author in pairs],
                "on_unassigned_task": [c.on_unassigned_task for c in cases],
                "when_assigned": [c.when_assigned for c in cases],
                "when_not_assigned": [c.when_not_assigned for c in cases],
            },
        ).all()
        if not rows or not rows[0][-1]:
            return rows
