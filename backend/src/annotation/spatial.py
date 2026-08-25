"""Raw-SQL spatial reads over a campaign's annotations.

Sits next to its functional core `tiles.py` (which builds the MVT query
string): this module is the DB-bound half that actually executes PostGIS
queries, kept out of `service.py`'s ORM-centric read/write flows.
"""

from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from src.annotation.constants import CHANGES_LIMIT, CHANGES_OVERLAP
from src.annotation.tiles import MIN_TILE_ZOOM, build_mvt_query, task_filter_sql
from src.campaigns.models import CampaignSettings


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


def _density_cell_size(
    db: Session, campaign_id: int, target_cells: int, include_tasks: bool
) -> float | None:
    """Grid cell size in degrees, or None if the campaign has no annotations.

    Sized from the campaign's own area of interest rather than from where its
    annotations happen to be. A single stray annotation on another continent stretches
    the annotation extent enormously, and a grid derived from that collapses the whole
    campaign into one cell - which is precisely when a distribution map stops being
    able to show anything. Outliers still appear; they simply land in cells beyond the
    area of interest instead of deciding how big every cell is.

    Shared so the plain and per-label grids land on identical cells; two cell sizes
    would put the same annotations in different places on two maps.
    """
    if get_campaign_annotations_extent(db, campaign_id, include_tasks=include_tasks) is None:
        return None
    settings = db.execute(
        select(
            CampaignSettings.bbox_west,
            CampaignSettings.bbox_south,
            CampaignSettings.bbox_east,
            CampaignSettings.bbox_north,
        ).where(CampaignSettings.campaign_id == campaign_id)
    ).first()
    if settings is None:
        return 0.01
    span = max(settings[2] - settings[0], settings[3] - settings[1])
    return span / target_cells if span > 0 else 0.01


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
    grid = _density_cell_size(db, campaign_id, target_cells, include_tasks)
    if grid is None:
        return []

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


def get_annotation_density_by_label(
    db: Session,
    campaign_id: int,
    target_cells: int = 48,
    include_tasks: bool = True,
    bbox: tuple[float, float, float, float] | None = None,
) -> list[dict]:
    """As :func:`get_annotation_density`, split by label.

    The review page's distribution map answers "where is each class", which the plain
    grid cannot: it only knows where annotations are. Splitting in the database keeps the
    property that makes the plain grid usable at all - one indexed pass, and a payload
    that grows with cells times labels rather than with the number of annotations.

    Each row carries that label's own mean centroid within the cell, so a class sits
    where its annotations actually are rather than at a shared cell centre.

    ``bbox`` restricts the result to a viewport *and* sizes the grid from it, which is
    what lets the same endpoint resolve to detail: zooming in shrinks the cells, counts
    fall, and at one annotation per cell the reported mean centroid is that annotation's
    own position. Without it the grid is fixed to the campaign's area of interest and no
    amount of zooming ever breaks a cell apart.
    """
    params: dict = {"campaign_id": campaign_id}
    if bbox is None:
        grid = _density_cell_size(db, campaign_id, target_cells, include_tasks)
        window = ""
    else:
        minx, miny, maxx, maxy = bbox
        span = max(maxx - minx, maxy - miny)
        grid = span / target_cells if span > 0 else 0.01
        window = "AND g.geometry && ST_MakeEnvelope(:minx, :miny, :maxx, :maxy, 4326)"
        params |= {"minx": minx, "miny": miny, "maxx": maxx, "maxy": maxy}
    if grid is None:
        return []
    params["grid"] = grid

    sql = text(
        f"""
        SELECT avg(ST_X(c)) AS lon, avg(ST_Y(c)) AS lat, label_id, count(*) AS n
        FROM (
            SELECT ST_Centroid(g.geometry) AS c, a.label_id AS label_id
            FROM data.annotations a
            JOIN data.annotation_geometries g ON g.id = a.geometry_id
            WHERE a.campaign_id = :campaign_id
              {task_filter_sql(include_tasks)}
              {window}
        ) AS pts
        GROUP BY floor(ST_X(c) / :grid), floor(ST_Y(c) / :grid), label_id
        ORDER BY n DESC
        """  # noqa: S608
    )
    rows = db.execute(sql, params).all()
    return [
        {
            "lon": float(r[0]),
            "lat": float(r[1]),
            "label_id": int(r[2]) if r[2] is not None else None,
            "count": int(r[3]),
        }
        for r in rows
    ]
