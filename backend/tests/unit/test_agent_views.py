import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src.agents.schemas import (
    BasemapContext,
    CampaignContext,
    CollectionContext,
    SliceContext,
    SourceContext,
    TimeseriesContext,
    ViewCell,
    ViewSpec,
)
from src.agents.views import OVERVIEW_MAX_CELLS, check_view, default_views, view_key


def _collection(month: int) -> CollectionContext:
    start = f"2025-{month:02d}-01"
    return CollectionContext(
        collection_id=month,
        name=start[:7],
        cover_slice_id=100 + month,
        slices=[SliceContext(slice_id=100 + month, name="", start_date=start, end_date=start)],
    )


def _context(months: int = 3, *, basemaps: bool = True, timeseries: bool = True):
    return CampaignContext(
        campaign_id=1,
        project_id=1,
        name="c",
        mode="tasks",
        bbox=(0, 0, 1, 1),
        sample_extent_meters=30,
        guide_markdown=None,
        labels=[],
        form_fields=[],
        imagery=[
            SourceContext(
                source_id=1,
                name="S2",
                on_demand=False,
                default_zoom=14,
                max_native_zoom=None,
                visualizations=["True Color", "False Color"],
                collections=[_collection(m) for m in range(1, months + 1)],
            )
        ],
        basemaps=[BasemapContext(basemap_id=9, name="Bing", max_native_zoom=19)]
        if basemaps
        else [],
        timeseries=[
            TimeseriesContext(
                timeseries_id=5,
                name="NDVI",
                group="Time series",
                data_source="S2",
                index="NDVI",
                start_ym="202501",
                end_ym="202512",
            )
        ]
        if timeseries
        else [],
    )


def test_default_overview_keeps_the_most_recent_covers_then_the_chart():
    overview, basemap = default_views(_context(months=OVERVIEW_MAX_CELLS + 2))

    slice_ids = [cell.slice_id for cell in overview.cells if cell.slice_id is not None]
    assert slice_ids == [100 + m for m in range(3, OVERVIEW_MAX_CELLS + 3)]
    assert overview.cells[-1].timeseries_ids == [5]
    assert overview.zoom == 14
    assert [cell.zoom for cell in basemap.cells] == [11, 15]


def test_default_views_without_imagery_or_basemaps_fall_back_to_the_chart():
    context = _context(basemaps=False).model_copy(update={"imagery": []})
    assert [[c.timeseries_ids for c in v.cells] for v in default_views(context)] == [[[5]]]


@pytest.mark.parametrize(
    "cell",
    [
        ViewCell(slice_id=999),
        ViewCell(slice_id=101, visualization="NDVI"),
        ViewCell(basemap_id=1),
        ViewCell(timeseries_ids=[5, 6]),
    ],
)
def test_check_view_rejects_what_the_campaign_does_not_have(cell):
    with pytest.raises(HTTPException) as exc:
        check_view(_context(), ViewSpec(cells=[cell]))
    assert exc.value.status_code == 422


def test_view_specs_validate_cells_and_image_size():
    with pytest.raises(ValidationError):
        ViewCell(slice_id=1, basemap_id=2)
    with pytest.raises(ValidationError):
        ViewSpec(cells=[ViewCell(slice_id=1)], columns=8, cell_px=512)
    with pytest.raises(ValidationError):
        ViewCell(slice_id=1, smoothed=True)


def test_view_key_ignores_unset_fields_but_not_values():
    explicit = ViewSpec(cells=[ViewCell(slice_id=1, visualization=None)], zoom=15)
    implicit = ViewSpec.model_validate({"cells": [{"slice_id": 1}]})
    assert view_key(explicit) == view_key(implicit)
    assert view_key(explicit) != view_key(ViewSpec(cells=[ViewCell(slice_id=1)], zoom=16))
