import logging
from collections import defaultdict
from uuid import UUID

import krippendorff
import numpy as np
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from src.annotation.models import Annotation
from src.auth.models import User
from src.campaigns.models import Campaign
from src.campaigns.schemas import AnnotatorInfo, CampaignStatistics, PairwiseAgreement

logger = logging.getLogger(__name__)


def _calculate_krippendorff_alpha(
    annotations_by_task: dict[int, list[tuple[UUID, int | None]]],
) -> float | None:
    """
    Calculate Krippendorff's Alpha for inter-annotator agreement using the krippendorff library.

    Args:
        annotations_by_task: Dict mapping task_id to list of (user_id, label_id) tuples

    Returns:
        Krippendorff's Alpha value (0-1) or None if not enough data
    """
    # Filter tasks with at least 2 annotations
    multi_annotated_tasks = {
        task_id: annots for task_id, annots in annotations_by_task.items() if len(annots) >= 2
    }

    if not multi_annotated_tasks:
        return None

    # Get all unique users and check if we have at least 2 different labels
    all_users = set()
    all_labels = set()
    for annots in multi_annotated_tasks.values():
        for user_id, label_id in annots:
            all_users.add(user_id)
            if label_id is not None:
                all_labels.add(label_id)

    if len(all_labels) < 2:
        return None  # Need at least 2 different labels for agreement

    # Build reliability data matrix for krippendorff library
    # Format: each row is an annotator, each column is an item (task)
    # Value is the label_id, or np.nan if annotator didn't annotate that task
    users_list = sorted(list(all_users))
    tasks_list = sorted(list(multi_annotated_tasks.keys()))

    reliability_data = []
    for user_id in users_list:
        row = []
        for task_id in tasks_list:
            annots = multi_annotated_tasks[task_id]
            user_label = np.nan  # Default to missing
            for u, label in annots:
                if u == user_id and label is not None:
                    user_label = float(label)
                    break
            row.append(user_label)
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
    user1_id: UUID, user2_id: UUID, annotations_by_task: dict[int, list[tuple[UUID, int | None]]]
) -> tuple[float | None, int]:
    """
    Calculate agreement percentage between two specific annotators.

    Args:
        user1_id: First annotator's user ID
        user2_id: Second annotator's user ID
        annotations_by_task: Dict mapping task_id to list of (user_id, label_id) tuples

    Returns:
        Tuple of (agreement_percentage, shared_tasks_count)
        Agreement is percentage (0-100) or None if no shared tasks
    """
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


def get_campaign_statistics(
    campaign_id: int,
    db: Session,
):
    """
    Calculate comprehensive statistics for a campaign.

    Args:
        campaign_id: ID of the campaign
        db: Database session

    Returns:
        CampaignStatistics object with annotator info and pairwise agreements
    """

    # Get campaign
    campaign = db.execute(select(Campaign).where(Campaign.id == campaign_id)).scalar_one_or_none()

    if not campaign:
        raise HTTPException(status_code=404, detail=f"Campaign {campaign_id} not found")

    # Get all annotations for this campaign with relationships
    annotations = (
        db.execute(
            select(Annotation)
            .where(Annotation.campaign_id == campaign_id)
            .options(joinedload(Annotation.annotation_task))
        )
        .unique()
        .scalars()
        .all()
    )

    if not annotations:
        # Return empty statistics
        return CampaignStatistics(
            campaign_id=campaign_id,
            campaign_name=campaign.name,
            total_annotations=0,
            tasks_with_multiple_annotations=0,
            overall_label_distribution={},
            krippendorff_alpha=None,
            annotators=[],
            pairwise_agreements=[],
        )

    # Get label mapping
    labels = campaign.settings.labels or {}
    label_id_to_name = {}
    if isinstance(labels, dict):
        for label_id, label_data in labels.items():
            if isinstance(label_data, dict):
                label_id_to_name[int(label_id)] = label_data.get("name", f"Label {label_id}")
            else:
                label_id_to_name[int(label_id)] = str(label_data)
    elif isinstance(labels, list):
        for label_data in labels:
            if isinstance(label_data, dict):
                lid = label_data.get("id")
                lname = label_data.get("name", f"Label {lid}")
                if lid is not None:
                    label_id_to_name[int(lid)] = lname

    # Batch fetch users
    user_ids = {ann.created_by_user_id for ann in annotations}
    users = db.execute(select(User).where(User.id.in_(user_ids))).scalars().all()
    user_map = {user.id: user for user in users}

    # Organize annotations by user and task
    annotations_by_user: dict[UUID, list[Annotation]] = defaultdict(list)
    annotations_by_task: dict[int, list[tuple[UUID, int | None]]] = defaultdict(list)

    for ann in annotations:
        annotations_by_user[ann.created_by_user_id].append(ann)
        if ann.annotation_task_id:
            annotations_by_task[ann.annotation_task_id].append(
                (ann.created_by_user_id, ann.label_id)
            )

    # Build annotator info list
    annotator_list = []
    user_ids_list = sorted(list(annotations_by_user.keys()))

    for user_id in user_ids_list:
        user = user_map.get(user_id)
        if not user:
            continue

        user_annots = annotations_by_user[user_id]

        # Calculate label distribution for this user
        label_dist = defaultdict(int)
        for ann in user_annots:
            if ann.label_id is not None:
                label_name = label_id_to_name.get(ann.label_id, f"Unknown ({ann.label_id})")
                label_dist[label_name] += 1

        annotator_list.append(
            AnnotatorInfo(
                user_id=str(user_id),
                user_email=user.email,
                user_display_name=user.display_name,
                total_annotations=len(user_annots),
                label_distribution=dict(label_dist),
            )
        )

    # Sort by total annotations (descending)
    annotator_list.sort(key=lambda x: x.total_annotations, reverse=True)

    # Calculate overall label distribution
    overall_label_dist = defaultdict(int)
    for ann in annotations:
        if ann.label_id is not None:
            label_name = label_id_to_name.get(ann.label_id, f"Unknown ({ann.label_id})")
            overall_label_dist[label_name] += 1

    # Count tasks with multiple annotations
    tasks_with_multiple = sum(1 for annots in annotations_by_task.values() if len(annots) >= 2)

    # Calculate Krippendorff's Alpha for overall inter-annotator agreement
    krippendorff_alpha = _calculate_krippendorff_alpha(annotations_by_task)

    # Calculate pairwise agreements between all annotators
    pairwise_list = []
    for i, user1_id in enumerate(user_ids_list):
        for user2_id in user_ids_list[i + 1 :]:  # Only calculate upper triangle (avoid duplicates)
            agreement_pct, shared_tasks = _calculate_pairwise_agreement(
                user1_id, user2_id, annotations_by_task
            )

            pairwise_list.append(
                PairwiseAgreement(
                    annotator1_id=str(user1_id),
                    annotator2_id=str(user2_id),
                    agreement_percentage=agreement_pct,
                    shared_tasks=shared_tasks,
                )
            )

    return CampaignStatistics(
        campaign_id=campaign_id,
        campaign_name=campaign.name,
        total_annotations=len(annotations),
        tasks_with_multiple_annotations=tasks_with_multiple,
        overall_label_distribution=dict(overall_label_dist),
        krippendorff_alpha=krippendorff_alpha,
        annotators=annotator_list,
        pairwise_agreements=pairwise_list,
    )
