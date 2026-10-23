from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.orm import Session

from src.annotation.constants import CHANGES_OVERLAP, DELETION_RETENTION
from src.annotation.models import DeletedAnnotation
from src.campaigns.models import Campaign


def record_annotation_deletions(
    db: Session, campaign_id: int, annotation_ids: Sequence[int]
) -> None:
    """Tombstone deleted annotations so the changes poll can report them.

    A deletion is the one change that leaves no row for the poll to read, so it
    gets a record of its own. Issued in the same transaction as the delete, like
    the version bump: a deletion nothing recorded is one no other annotator's
    map can learn about. Tombstones the poll can no longer be asked for go at
    the same time, which is what keeps the table the size of recent work.
    """
    if not annotation_ids:
        return
    db.execute(
        insert(DeletedAnnotation),
        [
            {"annotation_id": annotation_id, "campaign_id": campaign_id}
            for annotation_id in annotation_ids
        ],
    )
    db.execute(
        delete(DeletedAnnotation).where(
            DeletedAnnotation.campaign_id == campaign_id,
            DeletedAnnotation.deleted_at < func.now() - DELETION_RETENTION,
        )
    )


def deletion_cursor_expired(since: datetime, now: datetime) -> bool:
    """Whether deletions since ``since`` can still be answered from tombstones."""
    return now - since > DELETION_RETENTION


def get_deleted_annotation_ids(db: Session, campaign_id: int, since: datetime) -> list[int]:
    """Ids tombstoned since ``since``, for the changes poll.

    Reads back a little further than asked for the same reason the changes query
    does: a row is stamped when its transaction runs, not when it commits.
    """
    rows = db.scalars(
        select(DeletedAnnotation.annotation_id).where(
            DeletedAnnotation.campaign_id == campaign_id,
            DeletedAnnotation.deleted_at >= since - CHANGES_OVERLAP,
        )
    ).all()
    return list(rows)


def bump_campaign_annotations_version(db: Session, campaign_id: int) -> None:
    """Increment the campaign's annotation version counter.

    Issued in the same transaction as an annotation mutation so the new value
    commits atomically with the change. The counter is the cache-busting key in
    annotation vector-tile URLs; any change invalidates the affected tiles.
    """
    db.execute(
        update(Campaign)
        .where(Campaign.id == campaign_id)
        .values(annotations_version=Campaign.annotations_version + 1)
    )
