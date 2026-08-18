"""Pure functional core for serving open-mode annotations as vector tiles.

Holds the DB-free logic behind the MVT tile endpoint: parsing/validating the
inputs and assembling the PostGIS query. Kept separate from ``service.py`` so
it can be unit-tested without a database.
"""

MVT_LAYER_NAME = "annotations"

# ST_AsMVTGeom clips to the tile plus a 256/4096 buffer so strokes join across
# tile seams; the row filter has to reach that far too or the buffer stays empty.
TILE_QUERY_MARGIN = 0.0625

# Annotations made from a task carry ``annotation_task_id``; Explore hides them
# unless asked for. Shared by every spatial read so the map, the minimap, box
# selection and fit-to-bounds can never disagree about what exists.
TASK_ANNOTATION_EXCLUSION = "AND a.annotation_task_id IS NULL"


def task_filter_sql(include_tasks: bool) -> str:
    """SQL fragment restricting a query to annotations not made from a task."""
    return "" if include_tasks else TASK_ANNOTATION_EXCLUSION


class InvalidBBoxError(ValueError):
    """Raised when a bbox query string cannot be parsed into a valid extent."""


class InvalidTileError(ValueError):
    """Raised when z/x/y tile coordinates are outside the valid range."""


def parse_bbox(raw: str) -> tuple[float, float, float, float]:
    """Parse a ``"minx,miny,maxx,maxy"`` string into validated floats."""
    parts = [p.strip() for p in raw.split(",")]
    if len(parts) != 4:
        raise InvalidBBoxError("bbox must have exactly 4 comma-separated values")
    try:
        minx, miny, maxx, maxy = (float(p) for p in parts)
    except ValueError as exc:
        raise InvalidBBoxError("bbox values must be numeric") from exc
    if minx > maxx or miny > maxy:
        raise InvalidBBoxError("bbox min must not exceed max")
    return (minx, miny, maxx, maxy)


def validate_tile_coords(z: int, x: int, y: int) -> None:
    """Reject z/x/y that fall outside the standard XYZ tile grid."""
    if z < 0:
        raise InvalidTileError("zoom must be non-negative")
    max_index = (1 << z) - 1
    if not (0 <= x <= max_index) or not (0 <= y <= max_index):
        raise InvalidTileError(f"x/y must be within [0, {max_index}] at zoom {z}")


def build_mvt_query(
    z: int, x: int, y: int, campaign_id: int, include_tasks: bool = True
) -> tuple[str, dict]:
    """Build the PostGIS MVT query for one tile of a campaign's annotations.

    The spatial filter tests the bare ``g.geometry`` column against a tile
    envelope transformed into the geometry's SRID (4326), so the GiST index on
    that column is used; only the surviving rows are reprojected to 3857 for
    ``ST_AsMVTGeom``. Rows are selected against the margin-expanded envelope but
    clipped to the exact one, and geometry that misses the tile entirely (the
    ``&&`` bbox test passes rows whose shape does not actually overlap) is
    dropped rather than emitted as an attribute-only feature.

    ``include_tasks=False`` leaves out annotations made from a task.
    """
    validate_tile_coords(z, x, y)
    # S608: the only interpolations are module constants declared above. Every
    # caller-supplied value in this statement is bound.
    sql = f"""
        WITH bounds AS (
            SELECT
                ST_TileEnvelope(:z, :x, :y) AS clip_3857,
                ST_Transform(
                    ST_TileEnvelope(:z, :x, :y, margin => {TILE_QUERY_MARGIN}), 4326
                ) AS select_4326
        )
        SELECT ST_AsMVT(mvt.*, '{MVT_LAYER_NAME}') AS tile
        FROM (
            SELECT
                ST_AsMVTGeom(ST_Transform(g.geometry, 3857), bounds.clip_3857) AS geom,
                a.id AS annotation_id,
                a.label_id AS label_id
            FROM data.annotations a
            JOIN data.annotation_geometries g ON g.id = a.geometry_id
            CROSS JOIN bounds
            WHERE a.campaign_id = :campaign_id
              AND g.geometry && bounds.select_4326
              {task_filter_sql(include_tasks)}
        ) AS mvt
        WHERE mvt.geom IS NOT NULL
    """  # noqa: S608
    params = {"z": z, "x": x, "y": y, "campaign_id": campaign_id}
    return sql, params
