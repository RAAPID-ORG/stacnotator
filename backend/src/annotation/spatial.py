"""Raw-SQL spatial reads over a campaign's annotations.

Sits next to its functional core `tiles.py` (which builds the MVT query
string): this module is the DB-bound half that actually executes PostGIS
queries, kept out of `service.py`'s ORM-centric read/write flows.
"""

from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from src.annotation.constants import CHANGES_LIMIT, CHANGES_OVERLAP
from src.annotation.tiles import MIN_TILE_ZOOM, build_mvt_query, task_filter_sql


def render_annotation_tile(
    db: Session,
    campaign_id: int,
    z: int,
    x: int,
    y: int,
    include_tasks: bool = True,
) -> bytes:
    """Render one MVT tile of a campaign's annotations as protobuf bytes.

    Returns an empty tile (zero-length bytes) when no geometry falls in the
    tile, which OpenLayers treats as an empty tile. Zoom levels below
    ``MIN_TILE_ZOOM`` also return empty without touching the DB, so a continental
    view of a dense campaign can't trigger a multi-MB, CPU-heavy query.
    """
    if z < MIN_TILE_ZOOM:
        return b""
    sql, params = build_mvt_query(
        z=z, x=x, y=y, campaign_id=campaign_id, include_tasks=include_tasks
    )
    tile = db.execute(text(sql), params).scalar_one()
    return bytes(tile) if tile is not None else b""


def get_annotation_ids_in_bbox(
    db: Session,
    campaign_id: int,
    minx: float,
    miny: float,
    maxx: float,
    maxy: float,
    include_tasks: bool = True,
) -> list[int]:
    """Return ids of a campaign's annotations whose geometry intersects a bbox.

    Backs box/multi-select against the tiled display: the geometry never leaves
    the server, only the ids needed to highlight and bulk-delete. The filter
    keeps ``g.geometry`` bare so the GiST index is used.
    """
    sql = text(
        f"""
        SELECT a.id
        FROM data.annotations a
        JOIN data.annotation_geometries g ON g.id = a.geometry_id
        WHERE a.campaign_id = :campaign_id
          AND g.geometry && ST_MakeEnvelope(:minx, :miny, :maxx, :maxy, 4326)
          {task_filter_sql(include_tasks)}
        """  # noqa: S608
    )
    rows = db.execute(
        sql,
        {
            "campaign_id": campaign_id,
            "minx": minx,
            "miny": miny,
            "maxx": maxx,
            "maxy": maxy,
        },
    ).scalars()
    return list(rows)


def get_campaign_annotations_extent(
    db: Session,
    campaign_id: int,
    include_tasks: bool = True,
) -> tuple[float, float, float, float] | None:
    """Return the bounding box (minx, miny, maxx, maxy) of a campaign's
    annotations, or None when the campaign has none. Used for fit-to-bounds
    without loading every geometry into the client."""
    sql = text(
        f"""
        SELECT
            ST_XMin(ext), ST_YMin(ext), ST_XMax(ext), ST_YMax(ext)
        FROM (
            SELECT ST_Extent(g.geometry) AS ext
            FROM data.annotations a
            JOIN data.annotation_geometries g ON g.id = a.geometry_id
            WHERE a.campaign_id = :campaign_id
              {task_filter_sql(include_tasks)}
        ) AS e
        """  # noqa: S608
    )
    row = db.execute(sql, {"campaign_id": campaign_id}).first()
    if row is None or row[0] is None:
        return None
    return (float(row[0]), float(row[1]), float(row[2]), float(row[3]))


def get_annotation_density(
    db: Session,
    campaign_id: int,
    target_cells: int = 48,
    include_tasks: bool = True,
) -> list[dict]:
    """Aggregate a campaign's annotation centroids into a coarse grid for the
    minimap distribution overview.

    The grid is sized so the campaign's wider extent spans ~``target_cells``
    cells; each returned cell carries the mean centroid of the annotations in
    it (EPSG:4326) and how many there are. The cell only groups - the point
    reported is where the annotations actually are, so a dot on the minimap
    lines up with what the main map shows instead of sitting up to half a cell
    away. One indexed pass, tiny payload - independent of how many annotations
    exist, so it scales where per-feature dots would not.
    """
    extent = get_campaign_annotations_extent(db, campaign_id, include_tasks=include_tasks)
    if extent is None:
        return []
    minx, miny, maxx, maxy = extent
    span = max(maxx - minx, maxy - miny)
    grid = span / target_cells if span > 0 else 0.01

    sql = text(
        f"""
        SELECT avg(ST_X(c)) AS lon, avg(ST_Y(c)) AS lat, count(*) AS n
        FROM (
            SELECT ST_Centroid(g.geometry) AS c
            FROM data.annotations a
            JOIN data.annotation_geometries g ON g.id = a.geometry_id
            WHERE a.campaign_id = :campaign_id
              {task_filter_sql(include_tasks)}
        ) AS pts
        GROUP BY floor(ST_X(c) / :grid), floor(ST_Y(c) / :grid)
        """  # noqa: S608
    )
    rows = db.execute(sql, {"campaign_id": campaign_id, "grid": grid}).all()
    return [{"lon": float(r[0]), "lat": float(r[1]), "count": int(r[2])} for r in rows]


def server_now(db: Session) -> datetime:
    """The database clock. Cursors are compared against ``updated_at``, which
    the database stamps, so the app's clock is never the one that decides."""
    # Transaction start, which is what makes it a safe cursor: anything
    # committed after this poll began is stamped at or after it.
    now: datetime = db.execute(text("SELECT now()")).scalar_one()
    return now


def get_annotation_changes(
    db: Session,
    campaign_id: int,
    since: datetime,
    include_tasks: bool = True,
    limit: int = CHANGES_LIMIT,
) -> tuple[list[dict], bool]:
    """Annotations created or edited since ``since``, newest cursor first.

    Backs the poll that lets one annotator see another's work without either of
    them refetching tiles. Deletions are deliberately not reported: there is no
    tombstone to read, so a deletion by someone else shows up when the tiles are
    next fetched. Returns the rows and whether more were waiting than the limit.
    """
    # A cursor without an offset would be compared in whatever timezone the
    # database session happens to run in, which is hours of annotations either
    # way. Our own clients echo back what `server_now` gave them; anything else
    # is read as UTC rather than as local time.
    if since.tzinfo is None:
        since = since.replace(tzinfo=UTC)
    sql = text(
        f"""
        SELECT a.id, a.label_id, a.created_by_user_id, ST_AsText(g.geometry) AS geometry_wkt
        FROM data.annotations a
        JOIN data.annotation_geometries g ON g.id = a.geometry_id
        WHERE a.campaign_id = :campaign_id
          AND a.updated_at >= :since
          {task_filter_sql(include_tasks)}
        ORDER BY a.updated_at
        LIMIT :limit
        """  # noqa: S608
    )
    rows = db.execute(
        sql,
        {"campaign_id": campaign_id, "since": since - CHANGES_OVERLAP, "limit": limit + 1},
    ).mappings()
    changes = [
        {
            "id": row["id"],
            "label_id": row["label_id"],
            "created_by_user_id": row["created_by_user_id"],
            "geometry_wkt": row["geometry_wkt"],
        }
        for row in rows
    ]
    return changes[:limit], len(changes) > limit
