"""DB-free unit tests for the pure tile functional core (src/annotation/tiles.py).

These cover the bbox parser, tile-coordinate validation, and the MVT SQL
builder. The SQL builder test guards the index-friendly filter shape: the
spatial predicate must run against the untransformed geometry column so the
GiST index on annotation_geometries.geometry can be used.
"""

import pytest

from src.annotation.tiles import (
    InvalidBBoxError,
    InvalidTileError,
    build_mvt_query,
    parse_bbox,
    validate_tile_coords,
)

# --- parse_bbox --------------------------------------------------------------


def test_parse_bbox_valid():
    assert parse_bbox("-10,-5,10,5") == (-10.0, -5.0, 10.0, 5.0)


def test_parse_bbox_accepts_floats_and_whitespace():
    assert parse_bbox(" 1.5 , 2.5 , 3.5 , 4.5 ") == (1.5, 2.5, 3.5, 4.5)


def test_parse_bbox_rejects_wrong_arity():
    with pytest.raises(InvalidBBoxError):
        parse_bbox("1,2,3")


def test_parse_bbox_rejects_non_numeric():
    with pytest.raises(InvalidBBoxError):
        parse_bbox("a,b,c,d")


def test_parse_bbox_rejects_min_greater_than_max_x():
    with pytest.raises(InvalidBBoxError):
        parse_bbox("10,0,-10,5")


def test_parse_bbox_rejects_min_greater_than_max_y():
    with pytest.raises(InvalidBBoxError):
        parse_bbox("-10,5,10,-5")


# --- validate_tile_coords ----------------------------------------------------


def test_validate_tile_coords_accepts_in_range():
    validate_tile_coords(0, 0, 0)
    validate_tile_coords(2, 3, 3)


def test_validate_tile_coords_rejects_negative_zoom():
    with pytest.raises(InvalidTileError):
        validate_tile_coords(-1, 0, 0)


def test_validate_tile_coords_rejects_x_out_of_range():
    with pytest.raises(InvalidTileError):
        validate_tile_coords(2, 4, 0)  # max valid index at z=2 is 3


def test_validate_tile_coords_rejects_y_out_of_range():
    with pytest.raises(InvalidTileError):
        validate_tile_coords(2, 0, 4)


# --- build_mvt_query ---------------------------------------------------------


def test_build_mvt_query_binds_all_params():
    sql, params = build_mvt_query(z=5, x=10, y=12, campaign_id=42)
    assert params == {"z": 5, "x": 10, "y": 12, "campaign_id": 42}


def test_build_mvt_query_uses_index_friendly_filter():
    """The spatial filter must test the bare geometry column against a
    transformed tile envelope, never transform the column itself (which would
    defeat the GiST index)."""
    sql, _ = build_mvt_query(z=5, x=10, y=12, campaign_id=42)
    where = sql[sql.index("WHERE") :]
    assert "g.geometry &&" in where
    assert "ST_Transform(g.geometry" not in where


def test_build_mvt_query_emits_mvt_pipeline():
    sql, _ = build_mvt_query(z=1, x=0, y=0, campaign_id=1)
    assert "ST_TileEnvelope" in sql
    assert "ST_AsMVTGeom" in sql
    assert "ST_AsMVT" in sql


def test_build_mvt_query_selects_id_and_label():
    sql, _ = build_mvt_query(z=1, x=0, y=0, campaign_id=1)
    assert "a.id" in sql
    assert "a.label_id" in sql


def test_build_mvt_query_validates_coordinates():
    with pytest.raises(InvalidTileError):
        build_mvt_query(z=1, x=5, y=0, campaign_id=1)
