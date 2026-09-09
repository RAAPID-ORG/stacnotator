"""Areas of interest: a boundary file read into named areas that do not overlap.

Each feature is one area a person can report on. The geometry is kept in
EPSG:4326 beside the map and projected onto the grid only when a census needs
it, densified first so an edge that is straight in degrees stays on the right
side of the pixels it crosses once it curves in metres.
"""

import json
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree

from src.area_estimation.raster import MapError, Zone
from src.area_estimation.schemas import MAX_AREAS, StudyArea

NAME_COLUMNS = ("name", "NAME", "Name", "NAME_1", "ADM1_EN", "ADM2_EN", "admin", "label", "title")
EDGE_SEGMENT_DEGREES = 0.02


def _read_file(path: Path, file_name: str) -> gpd.GeoDataFrame:
    lower = file_name.lower()
    if lower.endswith(".zip"):
        location = _shapefile_in_zip(path)
    elif lower.endswith((".geojson", ".json")):
        location = str(path)
    else:
        raise MapError("Areas must be a GeoJSON file or a zipped shapefile")
    try:
        gdf = gpd.read_file(location)
    except Exception as exc:
        raise MapError(f"{file_name} could not be read as vector data") from exc
    if gdf.crs is None:
        if lower.endswith(".zip"):
            raise MapError(f"{file_name} has no coordinate reference system (.prj)")
        gdf = gdf.set_crs(epsg=4326)
    return gdf.to_crs(epsg=4326)


def _shapefile_in_zip(path: Path) -> str:
    try:
        with zipfile.ZipFile(path) as archive:
            members = [name for name in archive.namelist() if name.lower().endswith(".shp")]
    except zipfile.BadZipFile as exc:
        raise MapError("Not a zip file") from exc
    if len(members) != 1:
        raise MapError("The zip must contain exactly one shapefile")
    return f"zip://{path}!{members[0]}"


def _area_names(gdf: gpd.GeoDataFrame) -> list[str]:
    for column in NAME_COLUMNS:
        if column in gdf.columns and pd.api.types.is_string_dtype(gdf[column]):
            return ["" if pd.isna(v) else str(v) for v in gdf[column]]
    return [""] * len(gdf)


def read_areas(path: Path, file_name: str) -> tuple[list[StudyArea], dict]:
    """The areas in a boundary file, and the GeoJSON to keep them as."""
    gdf = _read_file(path, file_name)
    if len(gdf) == 0:
        raise MapError(f"{file_name} contains no features")
    if len(gdf) > MAX_AREAS:
        raise MapError(
            f"{file_name} has {len(gdf)} features; at most {MAX_AREAS} areas are supported"
        )

    names = _area_names(gdf)
    areas: list[StudyArea] = []
    features: list[dict] = []
    geometries: list[BaseGeometry] = []
    for index, (geometry, name) in enumerate(zip(gdf.geometry, names, strict=True)):
        if geometry is None or geometry.is_empty:
            raise MapError(f"Feature {index + 1} of {file_name} has no geometry")
        polygon = _polygonal(shapely.make_valid(geometry))
        if polygon.is_empty:
            raise MapError(f"Feature {index + 1} of {file_name} is not a polygon")
        area = StudyArea(
            id=f"area-{index + 1}",
            name=name.strip() or f"Area {index + 1}",
            feature_count=len(shapely.get_parts(polygon)),
        )
        areas.append(area)
        geometries.append(polygon)
        features.append(
            {
                "type": "Feature",
                "properties": {"id": area.id, "name": area.name},
                "geometry": json.loads(shapely.to_geojson(polygon)),
            }
        )
    _reject_overlaps(areas, geometries)
    return areas, {"type": "FeatureCollection", "features": features}


def _polygonal(geometry: BaseGeometry) -> BaseGeometry:
    parts = [
        part
        for part in shapely.get_parts(geometry)
        if part.geom_type == "Polygon" and not part.is_empty
    ]
    return shapely.union_all(parts) if parts else shapely.Polygon()


def _reject_overlaps(areas: list[StudyArea], geometries: list[BaseGeometry]) -> None:
    """Two areas sharing ground would count the same pixels twice."""
    tree = STRtree(geometries)
    for index, geometry in enumerate(geometries):
        for other in tree.query(geometry):
            if other <= index:
                continue
            if geometry.intersection(geometries[other]).area > 0:
                raise MapError(
                    f"Areas {areas[index].name!r} and {areas[other].name!r} overlap; "
                    "areas of interest must not share ground"
                )


def zones_on_grid(collection: dict, grid_crs_wkt: str) -> list[Zone]:
    """The stored areas projected onto the census grid."""
    features = collection["features"]
    if not features:
        return []
    ids = [feature["properties"]["id"] for feature in features]
    geometries = [
        shapely.segmentize(shapely.geometry.shape(feature["geometry"]), EDGE_SEGMENT_DEGREES)
        for feature in features
    ]
    projected = gpd.GeoSeries(geometries, crs="EPSG:4326").to_crs(grid_crs_wkt)
    return [
        Zone(id=zone_id, geometry=geometry)
        for zone_id, geometry in zip(ids, projected, strict=True)
    ]
