import os
import random
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import shapely
from sqlalchemy.orm import Session

from src.annotation.models import Annotation
from src.auth.models import User
from src.campaigns.models import Campaign
from src.database import engine
from src.geometry import ewkt
from src.organizations.models import Organization
from src.projects.models import Project, ProjectUser
from src.tasks import service
from src.tasks.models import Task, TaskAssignment, TaskSet
from src.tasks.schemas import TaskSummaryOut
from src.tasks.summary import task_summary_json

pytestmark = pytest.mark.skipif(
    os.environ.get("AGENT_DATABASE_TESTS") != "1",
    reason="Set AGENT_DATABASE_TESTS=1 against a migrated PostgreSQL database",
)

FORM_VALUES = (None, {}, {"1": 3}, {"1": "", "2": "x"}, {"3": [], "4": [1, 2]})


def make_user(db: Session, **kwargs) -> User:
    user = User(
        issuer="summary-test",
        external_uid=str(uuid4()),
        email=f"{uuid4().hex[:10]}@example.test",
        **kwargs,
    )
    db.add(user)
    db.flush()
    return user


@pytest.fixture
def varied_campaign():
    """Tasks in every state the summary has to describe, from a fixed seed."""
    rng = random.Random(7)
    with engine.connect() as connection, connection.begin() as transaction:
        with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
            organization = Organization(name=f"Summary test {uuid4()}", status="approved")
            db.add(organization)
            db.flush()
            project = Project(name="Summary test", organization_id=organization.id)
            db.add(project)
            db.flush()
            campaign = Campaign(
                project_id=project.id,
                name="Summary test",
                bbox_west=0,
                bbox_south=0,
                bbox_east=10,
                bbox_north=10,
                labels=[{"id": i, "name": f"L{i}", "geometry_type": "point"} for i in (1, 2)],
            )
            db.add(campaign)
            db.flush()
            task_set = TaskSet(campaign_id=campaign.id, name="Test")
            db.add(task_set)
            db.flush()
            people = [
                make_user(db, is_platform_admin=True, display_name=f"admin-{uuid4().hex[:6]}"),
                make_user(db),
                make_user(db, display_name=f"member-{uuid4().hex[:6]}"),
                make_user(db),
            ]
            db.add(ProjectUser(project_id=project.id, user_id=people[1].id, is_admin=True))
            db.add(ProjectUser(project_id=project.id, user_id=people[2].id, is_admin=False))
            db.flush()

            for n in range(1, 301):
                x, y = rng.uniform(0, 10), rng.uniform(0, 10)
                geometry = (
                    f"POINT({x} {y})"
                    if n % 4
                    else f"POLYGON(({x} {y},{x + 0.1} {y},{x + 0.1} {y + 0.1},{x} {y}))"
                )
                task = Task(
                    campaign_id=campaign.id,
                    task_set_id=task_set.id,
                    annotation_number=n,
                    geometry=ewkt(geometry),
                )
                if n % 9 == 0 and n // 9 <= len(people):  # one claim per person
                    task.claimed_by_user_id = people[n // 9 - 1].id
                    task.claimed_at = datetime(2026, 1, 1, tzinfo=UTC) + timedelta(minutes=n)
                db.add(task)
                db.flush()
                assigned = rng.sample(people, rng.randint(0, 3))
                for i, person in enumerate(assigned):
                    db.add(TaskAssignment(task_id=task.id, user_id=person.id, is_review=i == 2))
                for person in rng.sample(people, rng.randint(0, 4)):
                    labelled = rng.random() < 0.8
                    flagged = rng.random() < 0.2
                    db.add(
                        Annotation(
                            campaign_id=campaign.id,
                            task_id=task.id,
                            created_by_user_id=person.id,
                            geometry=ewkt(geometry),
                            outcome="labelled" if labelled else "skipped",
                            label_id=rng.choice((1, 2)) if labelled else None,
                            confidence=rng.choice((None, 1, 5)),
                            is_authoritative=rng.random() < 0.1,
                            flagged_for_review=flagged,
                            flag_comment=rng.choice((None, "look again")) if flagged else None,
                            comment=rng.choice((None, None, "a note")),
                            active_seconds=rng.choice((None, 12)),
                            form_values=rng.choice(FORM_VALUES),
                        )
                    )
                if n % 7 == 0:
                    db.add(
                        Annotation(
                            campaign_id=campaign.id,
                            output_of_task_id=task.id,
                            created_by_user_id=rng.choice(people).id,
                            geometry=ewkt(f"POINT({x} {y})"),
                            label_id=1,
                        )
                    )
                if n % 11 == 0:
                    db.add(
                        Annotation(
                            campaign_id=campaign.id,
                            origin_task_id=task.id,
                            created_by_user_id=rng.choice(people).id,
                            geometry=ewkt(f"POINT({x} {y})"),
                            label_id=2,
                        )
                    )
            db.commit()
            yield db, campaign
        transaction.rollback()


def rows(summary: TaskSummaryOut) -> dict[int, dict]:
    """The columnar summary as one record per task, in the read's own terms."""
    users = summary.users.id
    t = summary.tasks
    out = {
        task_id: {
            "annotation_number": t.annotation_number[i],
            "task_set_id": t.task_set_id[i],
            "task_status": t.task_status[i],
            "claimed_by_user_id": None if t.claimed_by[i] is None else users[t.claimed_by[i]],
            "claimed_at": t.claimed_at[i],
            "lonlat": (t.lon[i], t.lat[i]),
            "nearby_annotation_count": t.nearby_annotation_count[i],
            "drawn_by_user_ids": sorted(users[u] for u in t.drawn_by[i]),
            "assignments": [],
            "answers": [],
        }
        for i, task_id in enumerate(t.id)
    }
    a = summary.assignments
    for i, task in enumerate(a.task):
        out[t.id[task]]["assignments"].append((users[a.user[i]], a.status[i]))
    n = summary.answers
    for i, task in enumerate(n.task):
        out[t.id[task]]["answers"].append(
            {
                "id": n.id[i],
                "created_by_user_id": users[n.user[i]],
                "label_id": n.label_id[i],
                "outcome": n.outcome[i],
                "confidence": n.confidence[i],
                "flagged_for_review": n.flagged_for_review[i],
                "active_seconds": n.active_seconds[i],
                "is_authoritative": n.is_authoritative[i],
                "counts_toward_completion": n.counts_toward_completion[i],
                "comment": n.comment[i],
                "flag_comment": n.flag_comment[i],
                "updated_at": n.updated_at[i],
                "answered_field_ids": n.answered_field_ids[i],
            }
        )
    return out


def expected(task) -> dict:
    """The same record, from the full task read."""
    centroid = shapely.from_wkt(task.geometry_wkt).centroid
    return {
        "annotation_number": task.annotation_number,
        "task_set_id": task.task_set_id,
        "task_status": task.task_status,
        "claimed_by_user_id": task.claimed_by_user_id,
        "claimed_at": task.claimed_at,
        "lonlat": (round(centroid.x, 6), round(centroid.y, 6)),
        "nearby_annotation_count": task.nearby_annotation_count,
        "drawn_by_user_ids": sorted(task.drawn_by_user_ids),
        "assignments": sorted((a.user_id, a.status) for a in task.assignments),
        "answers": [
            {
                "id": a.id,
                "created_by_user_id": a.created_by_user_id,
                "label_id": a.label_id,
                "outcome": a.outcome,
                "confidence": a.confidence,
                "flagged_for_review": a.flagged_for_review,
                "active_seconds": a.active_seconds,
                "is_authoritative": a.is_authoritative,
                "counts_toward_completion": a.counts_toward_completion,
                "comment": a.comment,
                "flag_comment": a.flag_comment,
                "updated_at": a.updated_at,
                "answered_field_ids": sorted(
                    k for k, v in (a.form_values or {}).items() if v not in (None, "", [])
                ),
            }
            for a in task.annotations
        ],
    }


def test_the_summary_says_what_the_full_read_says(varied_campaign):
    db, campaign = varied_campaign

    summary = TaskSummaryOut.model_validate_json(task_summary_json(db, campaign, with_email=False))
    full = service.read_tasks(db, campaign, with_email=False)

    assert summary.tasks.id == [task.id for task in full]
    got = rows(summary)
    for record in got.values():
        record["assignments"].sort()
    assert got == {task.id: expected(task) for task in full}
    statuses = set(summary.tasks.task_status)
    assert {"pending", "done", "partial", "skipped", "conflicting"} <= statuses


def test_only_the_asked_tasks_and_no_emails_unless_admin(varied_campaign):
    db, campaign = varied_campaign
    some = [task.id for task in service.read_tasks(db, campaign, with_email=False)][5:9]

    member_view = TaskSummaryOut.model_validate_json(
        task_summary_json(db, campaign, some, with_email=False)
    )
    admin_view = TaskSummaryOut.model_validate_json(
        task_summary_json(db, campaign, some, with_email=True)
    )

    assert member_view.tasks.id == some
    assert set(member_view.users.email) == {None}
    assert all(admin_view.users.email)
    assert all(member_view.users.display_name)


def test_details_can_be_the_first_few_tasks(varied_campaign):
    db, campaign = varied_campaign

    first = service.read_tasks(db, campaign, with_email=False, first=3)

    assert [t.annotation_number for t in first] == [1, 2, 3]


def test_authors_the_lookup_missed_still_get_their_rule(varied_campaign, monkeypatch):
    """An author whose first answer commits after the author lookup is in the
    statement's rows without a rule; the summary must come out as if they were known."""
    db, campaign = varied_campaign
    expected_summary = TaskSummaryOut.model_validate_json(
        task_summary_json(db, campaign, with_email=False)
    )
    real_scalars = db.scalars
    calls: list[int] = []

    def lookup_misses_everyone(*args, **kwargs):
        if not calls:
            calls.append(1)
            return iter(())
        return real_scalars(*args, **kwargs)

    monkeypatch.setattr(db, "scalars", lookup_misses_everyone)
    summary = TaskSummaryOut.model_validate_json(task_summary_json(db, campaign, with_email=False))

    assert rows(summary) == rows(expected_summary)
