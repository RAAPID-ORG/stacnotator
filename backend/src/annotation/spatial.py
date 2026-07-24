"""Raw-SQL spatial reads over a campaign's annotations.

Sits next to its functional core `tiles.py` (which builds the MVT query
string): this module is the DB-bound half that actually executes PostGIS
queries, kept out of `service.py`'s ORM-centric read/write flows.
"""

from sqlalchemy import text
from sqlalchemy.orm import Session

from src.annotation.tiles import build_mvt_query
from src.config import get_settings


def render_annotation_tile(
    db: Session,
    campaign_id: int,
    z: int,
    x: int,
    y: int,
) -> bytes:
    """Render one MVT tile of a campaign's annotations as protobuf bytes.

    Returns an empty tile (zero-length bytes) when no geometry falls in the
    tile, which OpenLayers treats as an empty tile. Zoom levels below
    ``ANNOTATION_TILE_MIN_ZOOM`` also return empty without touching the DB, so a
    whole-country view of dense parcels can't trigger a multi-MB, CPU-heavy query.
    """
    if z < get_settings().ANNOTATION_TILE_MIN_ZOOM:
        return b""
    sql, params = build_mvt_query(z=z, x=x, y=y, campaign_id=campaign_id)
    tile = db.execute(text(sql), params).scalar_one()
    return bytes(tile) if tile is not None else b""


def get_annotation_ids_in_bbox(
    db: Session,
    campaign_id: int,
    minx: float,
    miny: float,
    maxx: float,
    maxy: float,
) -> list[int]:
    """Return ids of a campaign's annotations whose geometry intersects a bbox.

    Backs box/multi-select against the tiled display: the geometry never leaves
    the server, only the ids needed to highlight and bulk-delete. The filter
    keeps ``g.geometry`` bare so the GiST index is used.
    """
    sql = text(
        """
        SELECT a.id
        FROM data.annotations a
        JOIN data.annotation_geometries g ON g.id = a.geometry_id
        WHERE a.campaign_id = :campaign_id
          AND g.geometry && ST_MakeEnvelope(:minx, :miny, :maxx, :maxy, 4326)
        """
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
) -> tuple[float, float, float, float] | None:
    """Return the bounding box (minx, miny, maxx, maxy) of a campaign's
    annotations, or None when the campaign has none. Used for fit-to-bounds
    without loading every geometry into the client."""
    sql = text(
        """
        SELECT
            ST_XMin(ext), ST_YMin(ext), ST_XMax(ext), ST_YMax(ext)
        FROM (
            SELECT ST_Extent(g.geometry) AS ext
            FROM data.annotations a
            JOIN data.annotation_geometries g ON g.id = a.geometry_id
            WHERE a.campaign_id = :campaign_id
        ) AS e
        """
    )
    row = db.execute(sql, {"campaign_id": campaign_id}).first()
    if row is None or row[0] is None:
        return None
    return (float(row[0]), float(row[1]), float(row[2]), float(row[3]))


def get_annotation_density(
    db: Session,
    campaign_id: int,
    target_cells: int = 48,
) -> list[dict]:
    """Aggregate a campaign's annotation centroids into a coarse grid for the
    minimap distribution overview.

    The grid is sized so the campaign's wider extent spans ~``target_cells``
    cells; each returned cell carries its centre (EPSG:4326) and the count of
    annotations in it. One indexed pass, tiny payload - independent of how many
    annotations exist, so it scales where per-feature dots would not.
    """
    extent = get_campaign_annotations_extent(db, campaign_id)
    if extent is None:
        return []
    minx, miny, maxx, maxy = extent
    span = max(maxx - minx, maxy - miny)
    grid = span / target_cells if span > 0 else 0.01

    sql = text(
        """
        SELECT floor(ST_X(c) / :grid) * :grid + :grid / 2 AS lon,
               floor(ST_Y(c) / :grid) * :grid + :grid / 2 AS lat,
               count(*) AS n
        FROM (
            SELECT ST_Centroid(g.geometry) AS c
            FROM data.annotations a
            JOIN data.annotation_geometries g ON g.id = a.geometry_id
            WHERE a.campaign_id = :campaign_id
        ) AS pts
        GROUP BY 1, 2
        """
    )
    rows = db.execute(sql, {"campaign_id": campaign_id, "grid": grid}).all()
    return [{"lon": float(r[0]), "lat": float(r[1]), "count": int(r[2])} for r in rows]
