"""Geometry columns as tasks and annotations store them: WGS84, written from WKT."""

from geoalchemy2 import Geometry as GeoAlchemyGeometry
from geoalchemy2.elements import WKBElement, WKTElement
from shapely import wkt as shapely_wkt
from shapely.errors import ShapelyError
from sqlalchemy.orm import Mapped, mapped_column


def ewkt(wkt: str) -> WKTElement:
    """WGS84 WKT in the form geometry columns accept on write."""
    return WKTElement(wkt, srid=4326)


def valid_wkt(value: str) -> str:
    """The WKT itself when it parses to a non-empty, valid geometry (a bowtie polygon is
    not); raises ValueError otherwise, which pydantic reports as a 422."""
    try:
        geom = shapely_wkt.loads(value)
    except (ShapelyError, TypeError) as exc:
        raise ValueError("Geometry is not valid WKT") from exc
    if geom.is_empty:
        raise ValueError("Geometry is empty")
    if not geom.is_valid:
        raise ValueError("Geometry is invalid (for example a self-intersecting polygon)")
    return value


def geometry_column() -> Mapped[WKBElement | WKTElement]:
    """A row's own WGS84 geometry; geoalchemy2 hands back a WKBElement on read and
    writes take ewkt(wkt). The GiST index is declared with the table."""
    return mapped_column(
        GeoAlchemyGeometry(geometry_type="GEOMETRY", srid=4326, spatial_index=False),
        nullable=False,
    )
