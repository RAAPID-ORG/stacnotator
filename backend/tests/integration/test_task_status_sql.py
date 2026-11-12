import itertools
import os
from uuid import uuid4

import pytest
from sqlalchemy import text

from src.database import engine
from src.tasks.status import STATUS_SQL, compute_task_status_value, derive_assignment_status

pytestmark = pytest.mark.skipif(
    os.environ.get("AGENT_DATABASE_TESTS") != "1",
    reason="Set AGENT_DATABASE_TESTS=1 against a PostgreSQL database",
)

USERS = [uuid4() for _ in range(3)]
ROLES = (None, "primary", "review")
# None: no annotation. Otherwise (answer, is_authoritative, counts); answer None is a skip.
ANSWERS = (None,) + tuple(itertools.product((None, "A", "B"), (False, True), (False, True)))


def every_task():
    """Each person on a task is unassigned, assigned or reviewing, and has no answer, a
    skip or one of two labels, authoritative or not, counted or not."""
    per_user = list(itertools.product(ROLES, ANSWERS))
    return enumerate(itertools.product(per_user, repeat=len(USERS)))


def test_the_sql_status_agrees_with_the_rule_on_every_combination():
    assignments, answers = [], []
    expected_task, expected_assignee = {}, {}
    for task_id, people in every_task():
        assignment_list = [
            {"user_id": user, "is_review": role == "review"}
            for user, (role, _) in zip(USERS, people, strict=True)
            if role
        ]
        annotation_list = [
            {
                "answer": answer[0],
                "created_by_user_id": user,
                "is_authoritative": answer[1],
                "counts_toward_completion": answer[2],
            }
            for user, (_, answer) in zip(USERS, people, strict=True)
            if answer
        ]
        assignments += [(task_id, a["user_id"], a["is_review"]) for a in assignment_list]
        answers += [
            (
                task_id,
                a["created_by_user_id"],
                a["answer"],
                a["is_authoritative"],
                a["counts_toward_completion"],
            )
            for a in annotation_list
        ]
        expected_task[task_id] = compute_task_status_value(assignment_list, annotation_list)
        for a in assignment_list:
            expected_assignee[(task_id, a["user_id"])] = derive_assignment_status(
                annotation_list, a["user_id"]
            )

    def column(rows, i, cast=lambda v: v):
        return [cast(r[i]) if r[i] is not None else None for r in rows]

    params = {
        "a_task": column(assignments, 0),
        "a_user": column(assignments, 1, str),
        "a_review": column(assignments, 2),
        "n_task": column(answers, 0),
        "n_user": column(answers, 1, str),
        "n_answer": column(answers, 2),
        "n_auth": column(answers, 3),
        "n_counts": column(answers, 4),
    }
    inputs = """
        WITH status_assignments AS (
            SELECT * FROM unnest(CAST(:a_task AS int[]), CAST(:a_user AS uuid[]),
                                 CAST(:a_review AS bool[])) AS t(task_id, user_id, is_review)
        ),
        status_answers AS (
            SELECT * FROM unnest(CAST(:n_task AS int[]), CAST(:n_user AS uuid[]),
                                 CAST(:n_answer AS text[]), CAST(:n_auth AS bool[]),
                                 CAST(:n_counts AS bool[]))
                AS t(task_id, user_id, answer, is_authoritative, counts)
        ),
    """
    with engine.connect() as connection:
        tasks = dict(
            connection.execute(
                text(inputs + STATUS_SQL + "SELECT task_id, status FROM task_statuses"), params
            ).all()
        )
        assignees = {
            (task_id, user_id): status
            for task_id, user_id, status in connection.execute(
                text(
                    inputs + STATUS_SQL + "SELECT task_id, user_id, status FROM assignee_statuses"
                ),
                params,
            )
        }

    actual_task = {task_id: tasks.get(task_id, "pending") for task_id in expected_task}
    assert actual_task == expected_task
    assert assignees == expected_assignee
