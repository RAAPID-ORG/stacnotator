"""Drop form values whose shape no longer matches their field type.

Values written before update_campaign_form_fields started rejecting
type/option changes on answered fields can disagree with the current field
definition (e.g. a category value that is not an option id). The export
degradation path for such drift is being removed, so the drifted values go
too: a mismatched value is dropped from the annotation's form_values (the
answer is unrecoverable anyway - its field no longer means what it did).

Only the three shapes the export shim special-cased are checked: category
(int), multicategory (list[int]) and daterange ({start, end} strings).
"""

import json
from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

revision: str = "aa7formnorm"
down_revision: str | Sequence[str] | None = "aa6polback"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _is_int(v: object) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _matches(field_type: str, value: object) -> bool:
    if field_type == "category":
        return _is_int(value)
    if field_type == "multicategory":
        return isinstance(value, list) and all(_is_int(v) for v in value)
    return (
        isinstance(value, dict)
        and isinstance(value.get("start"), str)
        and isinstance(value.get("end"), str)
    )


def upgrade() -> None:
    conn = op.get_bind()
    campaigns = conn.execute(
        text(
            "SELECT campaign_id, form_fields FROM data.settings "
            "WHERE jsonb_array_length(coalesce(form_fields, '[]'::jsonb)) > 0"
        )
    ).fetchall()
    for campaign_id, fields in campaigns:
        checked_types = {
            str(field["id"]): field["type"]
            for field in fields
            if field.get("type") in ("category", "multicategory", "daterange")
        }
        if not checked_types:
            continue
        rows = conn.execute(
            text(
                "SELECT id, form_values FROM data.annotations "
                "WHERE campaign_id = :cid AND form_values IS NOT NULL"
            ),
            {"cid": campaign_id},
        ).fetchall()
        for annotation_id, values in rows:
            drifted = [
                key
                for key, value in values.items()
                if key in checked_types and not _matches(checked_types[key], value)
            ]
            if not drifted:
                continue
            for key in drifted:
                values.pop(key)
            conn.execute(
                text("UPDATE data.annotations SET form_values = (:values)::jsonb WHERE id = :id"),
                {"values": json.dumps(values) if values else None, "id": annotation_id},
            )


def downgrade() -> None:
    # Dropped values are gone; nothing to restore.
    pass
