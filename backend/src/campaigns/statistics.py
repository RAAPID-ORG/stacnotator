import logging
from collections import Counter, defaultdict
from collections.abc import Iterable
from typing import Any, NamedTuple
from uuid import UUID

import krippendorff
import numpy as np
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from src.annotation.models import Annotation, AnnotationTask
from src.annotation.status import task_answer
from src.auth.models import User
from src.campaigns.models import Campaign
from src.campaigns.schemas import (
    AnnotatorInfo,
    CampaignStatistics,
    PairwiseAgreement,
)

logger = logging.getLogger(__name__)


Answer = int | str | None
"""What one annotator answered on a task (see annotation.status.task_answer)."""


def _calculate_krippendorff_alpha(
    annotations_by_task: dict[int, list[tuple[UUID, Answer]]],
) -> float | None:
    """Krippendorff's Alpha (nominal) over every task with at least two annotators,
    or None when there is not enough to compare."""
    # Filter tasks with at least 2 annotations
    multi_annotated_tasks = {
        task_id: annots for task_id, annots in annotations_by_task.items() if len(annots) >= 2
    }

    if not multi_annotated_tasks:
        return None

    all_users = set()
    codes: dict[int | str, float] = {}
    for annots in multi_annotated_tasks.values():
        for user_id, answer in annots:
            all_users.add(user_id)
            if answer is not None:
                codes.setdefault(answer, float(len(codes)))

    if len(codes) < 2:
        return None

    # One row per annotator, one column per task; a skip or a task the
    # annotator never saw is missing (nan). Answers are nominal codes.
    users_list = sorted(list(all_users))
    tasks_list = sorted(list(multi_annotated_tasks.keys()))

    reliability_data = []
    for user_id in users_list:
        row = []
        for task_id in tasks_list:
            annots = multi_annotated_tasks[task_id]
            user_code = np.nan
            for u, answer in annots:
                if u == user_id and answer is not None:
                    user_code = codes[answer]
                    break
            row.append(user_code)
        reliability_data.append(row)

    # Convert to numpy array
    reliability_matrix = np.array(reliability_data)

    # Calculate Krippendorff's Alpha using nominal metric
    try:
        alpha = krippendorff.alpha(reliability_matrix, level_of_measurement="nominal")
        return float(alpha) if not np.isnan(alpha) else None
    except Exception:
        return None


def _calculate_pairwise_agreement(
    user1_id: UUID, user2_id: UUID, annotations_by_task: dict[int, list[tuple[UUID, Answer]]]
) -> tuple[float | None, int]:
    """Percentage (0-100) of the tasks both annotators answered on which they
    agree, and how many such tasks there were. None when there were none."""
    shared_annotations = []

    for _task_id, annots in annotations_by_task.items():
        user1_label = None
        user2_label = None

        for user_id, label_id in annots:
            if user_id == user1_id:
                user1_label = label_id
            elif user_id == user2_id:
                user2_label = label_id

        # Only count if both users annotated this task
        if user1_label is not None and user2_label is not None:
            shared_annotations.append((user1_label, user2_label))

    if not shared_annotations:
        return None, 0

    # Calculate agreement
    agreements = sum(1 for label1, label2 in shared_annotations if label1 == label2)
    agreement_pct = (agreements / len(shared_annotations)) * 100.0

    return agreement_pct, len(shared_annotations)


class AnnotatorDurations(NamedTuple):
    timed_tasks: int
    median_seconds_per_task: int
    total_active_seconds: int


def summarize_annotator_durations(
    rows: Iterable[tuple[UUID, int | None]],
) -> dict[UUID, AnnotatorDurations]:
    """Summarize (user_id, active_seconds) annotation rows per annotator.

    Rows without a measurement are dropped rather than counted as zero, so work
    predating the measurement does not deflate the result. The median
    is reported rather than the mean because a single tab left open on one task
    would otherwise dominate an annotator's figure.
    """
    by_user: defaultdict[UUID, list[int]] = defaultdict(list)
    for user_id, seconds in rows:
        if seconds is not None:
            by_user[user_id].append(seconds)

    return {
        user_id: AnnotatorDurations(
            timed_tasks=len(values),
            median_seconds_per_task=round(float(np.median(values))),
            total_active_seconds=sum(values),
        )
        for user_id, values in by_user.items()
    }


def _scoped_to_set(query: Select[Any], task_set_id: int | None) -> Select[Any]:
    """Narrow an annotation query to one task set.

    Agreement is only meaningful within a set: two sets are two different
    samples, and pooling them mixes tasks nobody was asked to label twice into
    the denominator. The inner join also drops standalone annotations, which
    belong to no set and no task.
    """
    if task_set_id is None:
        return query
    return query.join(AnnotationTask, Annotation.annotation_task_id == AnnotationTask.id).where(
        AnnotationTask.task_set_id == task_set_id
    )


def get_campaign_statistics(
    db: Session,
    campaign: Campaign,
    task_set_id: int | None = None,
) -> CampaignStatistics:
    """Per-annotator counts, label distributions, timing and agreement for a
    campaign, or one of its task sets."""
    annotations = db.scalars(
        _scoped_to_set(select(Annotation).where(Annotation.campaign_id == campaign.id), task_set_id)
    ).all()

    label_names = campaign.label_names

    def label_distribution(anns: Iterable[Annotation]) -> dict[str, int]:
        return dict(
            Counter(
                label_names.get(a.label_id, f"Unknown ({a.label_id})")
                for a in anns
                if a.label_id is not None
            )
        )

    annotations_by_user: dict[UUID, list[Annotation]] = defaultdict(list)
    annotations_by_task: dict[int, list[tuple[UUID, Answer]]] = defaultdict(list)
    for ann in annotations:
        annotations_by_user[ann.created_by_user_id].append(ann)
        if ann.annotation_task_id:
            annotations_by_task[ann.annotation_task_id].append(
                (ann.created_by_user_id, task_answer(ann))
            )

    durations = summarize_annotator_durations(
        (a.created_by_user_id, a.active_seconds) for a in annotations if a.annotation_task_id
    )
    users = {
        user.id: user for user in db.scalars(select(User).where(User.id.in_(annotations_by_user)))
    }

    annotators = []
    for user_id, user_annots in annotations_by_user.items():
        user = users.get(user_id)
        if user is None:
            continue
        timing = durations.get(user_id)
        annotators.append(
            AnnotatorInfo(
                user_id=str(user_id),
                user_email=user.email,
                user_display_name=user.display_name,
                total_annotations=len(user_annots),
                label_distribution=label_distribution(user_annots),
                timed_tasks=timing.timed_tasks if timing else 0,
                median_seconds_per_task=timing.median_seconds_per_task if timing else None,
                total_active_seconds=timing.total_active_seconds if timing else None,
            )
        )
    annotators.sort(key=lambda x: x.total_annotations, reverse=True)

    user_ids = sorted(annotations_by_user)
    pairwise = []
    for i, user1_id in enumerate(user_ids):
        for user2_id in user_ids[i + 1 :]:
            agreement_pct, shared_tasks = _calculate_pairwise_agreement(
                user1_id, user2_id, annotations_by_task
            )
            pairwise.append(
                PairwiseAgreement(
                    annotator1_id=str(user1_id),
                    annotator2_id=str(user2_id),
                    agreement_percentage=agreement_pct,
                    shared_tasks=shared_tasks,
                )
            )

    return CampaignStatistics(
        campaign_id=campaign.id,
        campaign_name=campaign.name,
        total_annotations=len(annotations),
        tasks_with_multiple_annotations=sum(
            1 for annots in annotations_by_task.values() if len(annots) >= 2
        ),
        overall_label_distribution=label_distribution(annotations),
        krippendorff_alpha=_calculate_krippendorff_alpha(annotations_by_task),
        annotators=annotators,
        pairwise_agreements=pairwise,
    )
