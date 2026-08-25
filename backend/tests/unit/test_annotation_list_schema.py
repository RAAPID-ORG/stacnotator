from src.annotation.schemas import AnnotationListItemOut, AnnotationOut, AnnotationsPageOut
from src.annotation.service import _SORTS, MAX_ANNOTATION_PAGE


def test_the_list_row_carries_no_geometry():
    """The whole reason this schema exists. Geometry is what turned one page load into
    a 70 MB, ten-second request on a campaign with 100k annotations."""
    assert "geometry" not in AnnotationListItemOut.model_fields
    assert "geometry" in AnnotationOut.model_fields


def test_the_list_row_carries_a_point_to_fly_to():
    """The table's View action needs somewhere to navigate, which is the only thing it
    ever used the geometry for."""
    assert {"centroid_lat", "centroid_lon"} <= set(AnnotationListItemOut.model_fields)


def test_the_list_row_carries_what_the_table_renders():
    needed = {
        "id",
        "label_id",
        "confidence",
        "flagged_for_review",
        "annotation_task_id",
        "created_at",
        "created_by_user_id",
        "created_by_user_email",
        "created_by_user_display_name",
    }
    assert needed <= set(AnnotationListItemOut.model_fields)


def test_a_page_reports_the_filtered_total():
    """Without it the client cannot show "n of m" or know when to stop paging."""
    assert {"items", "total", "limit", "offset"} <= set(AnnotationsPageOut.model_fields)


def test_every_sort_the_table_offers_is_supported():
    from typing import get_args

    from src.annotation.schemas import AnnotationSort

    # The API's declared sorts and the ones the query can actually build must match, or
    # a dropdown option silently does nothing - which is what "time-asc" used to do.
    assert set(_SORTS) == set(get_args(AnnotationSort))


def test_the_page_size_is_bounded():
    """A caller asking for everything must not be able to reinstate the old behaviour."""
    assert 0 < MAX_ANNOTATION_PAGE <= 500


def test_the_distribution_grid_is_broken_down_by_class():
    """The review map answers "where is each class", which needs the label on every
    cell. The plain density grid only knows where annotations are at all."""
    from src.annotation.schemas import AnnotationDensityCell, AnnotationLabelDensityCell

    assert "label_id" in AnnotationLabelDensityCell.model_fields
    assert "label_id" not in AnnotationDensityCell.model_fields
    # Unlabelled annotations are a class on the map too, so None must be allowed.
    assert AnnotationLabelDensityCell(lon=1.0, lat=2.0, label_id=None, count=3).label_id is None
    assert {"lon", "lat", "count"} <= set(AnnotationLabelDensityCell.model_fields)


def test_literal_annotation_routes_are_declared_before_the_id_route():
    """A literal segment must be registered before the ``{annotation_id}`` catch-all.

    FastAPI matches in declaration order, so a later literal is shadowed: the request
    reaches the id route and fails with "unable to parse 'facets' as an integer" rather
    than doing what it says. Cheap to get wrong, silent until someone calls it.
    """
    from src.main import app

    order = [
        (r.path, m)
        for r in app.routes
        for m in getattr(r, "methods", set()) or set()
        if getattr(r, "path", "").startswith("/api/campaigns/{campaign_id}/annotations")
    ]
    gets = [path for path, method in order if method == "GET"]
    catch_all = gets.index("/api/campaigns/{campaign_id}/annotations/{annotation_id}")
    for literal in ("facets", "density-by-label", "ids", "extent", "density", "changes"):
        path = f"/api/campaigns/{{campaign_id}}/annotations/{literal}"
        assert gets.index(path) < catch_all, f"{literal} is shadowed by {{annotation_id}}"
