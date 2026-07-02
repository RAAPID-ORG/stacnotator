import pandas as pd

from stacnotator._samples import SAMPLE_COLUMNS, samples_frame


def feature(
    geometry,
    annotation_id=1,
    task_id=10,
    label_id=1,
    label_name="Maize",
    confidence=8,
    annotator="a@b.c",
    created_at="2026-06-01T10:00:00+00:00",
):
    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": {
            "stacnotator_annotation_id": annotation_id,
            "stacnotator_task_id": task_id,
            "stacnotator_label_id": label_id,
            "stacnotator_label_name": label_name,
            "stacnotator_confidence": confidence,
            "stacnotator_created_by_user_email": annotator,
            "stacnotator_created_at": created_at,
        },
    }


def collection(*features):
    return {"type": "FeatureCollection", "features": list(features)}


POINT = {"type": "Point", "coordinates": [13.4, 52.5]}
UNIT_SQUARE = {
    "type": "Polygon",
    "coordinates": [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], [0.0, 0.0]]],
}


def test_point_feature_maps_to_row():
    df = samples_frame(collection(feature(POINT)))

    assert list(df.columns) == SAMPLE_COLUMNS
    row = df.iloc[0]
    assert row["annotation_id"] == 1
    assert row["task_id"] == 10
    assert row["lon"] == 13.4
    assert row["lat"] == 52.5
    assert row["label_id"] == 1
    assert row["label"] == "Maize"
    assert row["confidence"] == 8
    assert row["annotator"] == "a@b.c"
    assert row["created_at"] == pd.Timestamp("2026-06-01T10:00:00+00:00")
    assert row["geometry"] == POINT


def test_polygon_keeps_geometry_verbatim_without_lat_lon():
    df = samples_frame(collection(feature(UNIT_SQUARE)))

    row = df.iloc[0]
    assert row["geometry"] == UNIT_SQUARE
    assert pd.isna(row["lat"])
    assert pd.isna(row["lon"])


def test_multipolygon_kept_verbatim():
    small = [[[10.0, 10.0], [10.2, 10.0], [10.2, 10.2], [10.0, 10.2], [10.0, 10.0]]]
    multi = {"type": "MultiPolygon", "coordinates": [small, UNIT_SQUARE["coordinates"]]}

    df = samples_frame(collection(feature(multi)))

    assert df.iloc[0]["geometry"] == multi
    assert pd.isna(df.iloc[0]["lat"])


def test_unlabeled_skip_rows_are_dropped():
    df = samples_frame(
        collection(
            feature(POINT, annotation_id=1),
            feature(POINT, annotation_id=2, label_id=None, label_name=None),
        )
    )

    assert df["annotation_id"].tolist() == [1]


def test_null_geometry_rows_are_dropped():
    df = samples_frame(collection(feature(None, annotation_id=1), feature(POINT, annotation_id=2)))

    assert df["annotation_id"].tolist() == [2]


def test_empty_collection_yields_typed_empty_frame():
    df = samples_frame(collection())

    assert df.empty
    assert list(df.columns) == SAMPLE_COLUMNS


def test_open_mode_annotation_without_task():
    f = feature(POINT)
    del f["properties"]["stacnotator_task_id"]

    df = samples_frame(collection(f))

    assert pd.isna(df.iloc[0]["task_id"])
    assert df["task_id"].dtype == "Int64"


def test_merged_export_without_annotation_id_still_parses():
    f = feature(POINT)
    del f["properties"]["stacnotator_annotation_id"]

    df = samples_frame(collection(f))

    assert pd.isna(df.iloc[0]["annotation_id"])


def test_all_point_frame_has_float_lat_lon():
    df = samples_frame(collection(feature(POINT), feature(POINT, annotation_id=2)))

    assert df["lat"].tolist() == [52.5, 52.5]
    assert df["lon"].tolist() == [13.4, 13.4]
