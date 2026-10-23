"""Geometry columns as tasks and annotations store them: WGS84, written from WKT."""

from geoalchemy2 import Geometry as GeoAlchemyGeometry
from geoalchemy2.elements import WKBElement, WKTElement
from sqlalchemy.orm import Mapped, mapped_column


def ewkt(wkt: str) -> WKTElement:
    """WGS84 WKT in the form geometry columns accept on write."""
    return WKTElement(wkt, srid=4326)


def geometry_column() -> Mapped[WKBElement | WKTElement]:
    """A row's own WGS84 geometry; geoalchemy2 hands back a WKBElement on read and
    writes take ewkt(wkt). The GiST index is declared with the table."""
    return mapped_column(
        GeoAlchemyGeometry(geometry_type="GEOMETRY", srid=4326, spatial_index=False),
        nullable=False,
    )
