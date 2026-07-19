from src.timeseries.windows import (
    DEFAULT_TIMESERIES_WINDOW_KEY,
    distinct_window_keys,
    is_timeseries_window_key,
    sync_timeseries_windows_in_layout,
    window_grid_key,
)


def test_unnamed_window_uses_the_historical_default_key():
    # Back-compat: layouts persisted before windows were splittable used the
    # bare "timeseries" key, so unnamed timeseries must keep landing there.
    assert window_grid_key(None) == DEFAULT_TIMESERIES_WINDOW_KEY
    assert window_grid_key("") == DEFAULT_TIMESERIES_WINDOW_KEY
    assert window_grid_key("   ") == DEFAULT_TIMESERIES_WINDOW_KEY


def test_named_window_is_prefixed():
    assert window_grid_key("Vegetation") == "timeseries:Vegetation"
    assert window_grid_key("  Water  ") == "timeseries:Water"


def test_is_timeseries_window_key():
    assert is_timeseries_window_key("timeseries")
    assert is_timeseries_window_key("timeseries:Vegetation")
    assert not is_timeseries_window_key("main")
    assert not is_timeseries_window_key("42")


def test_distinct_window_keys_dedupes_and_preserves_order():
    names = ["Vegetation", None, "Vegetation", "Water", ""]
    assert distinct_window_keys(names) == [
        "timeseries:Vegetation",
        "timeseries",
        "timeseries:Water",
    ]


def test_sync_adds_one_entry_per_window():
    layout: list[dict] = [{"i": "main", "x": 0, "y": 0, "w": 60, "h": 20}]
    changed = sync_timeseries_windows_in_layout(layout, ["timeseries", "timeseries:Water"])
    assert changed is True
    keys = [item["i"] for item in layout]
    assert keys.count("timeseries") == 1
    assert keys.count("timeseries:Water") == 1
    assert "main" in keys


def test_sync_is_idempotent():
    layout: list[dict] = [{"i": "main", "x": 0, "y": 0, "w": 60, "h": 20}]
    sync_timeseries_windows_in_layout(layout, ["timeseries"])
    snapshot = [dict(item) for item in layout]
    changed = sync_timeseries_windows_in_layout(layout, ["timeseries"])
    assert changed is False
    assert layout == snapshot


def test_sync_drops_windows_no_longer_wanted():
    layout: list[dict] = [
        {"i": "main", "x": 0, "y": 0, "w": 60, "h": 20},
        {"i": "timeseries", "x": 0, "y": 20, "w": 10, "h": 4},
        {"i": "timeseries:Water", "x": 10, "y": 20, "w": 10, "h": 4},
    ]
    changed = sync_timeseries_windows_in_layout(layout, ["timeseries"])
    assert changed is True
    keys = [item["i"] for item in layout]
    assert keys == ["main", "timeseries"]


def test_sync_removes_all_timeseries_windows_when_none_desired():
    layout: list[dict] = [
        {"i": "main", "x": 0, "y": 0, "w": 60, "h": 20},
        {"i": "timeseries", "x": 0, "y": 20, "w": 10, "h": 4},
    ]
    changed = sync_timeseries_windows_in_layout(layout, [])
    assert changed is True
    assert [item["i"] for item in layout] == ["main"]


def test_sync_does_not_move_existing_windows():
    # A window the user has already dragged somewhere must keep its slot; sync
    # only adds or removes, never repositions.
    layout: list[dict] = [
        {"i": "timeseries", "x": 30, "y": 5, "w": 12, "h": 6},
    ]
    sync_timeseries_windows_in_layout(layout, ["timeseries", "timeseries:Water"])
    existing = next(item for item in layout if item["i"] == "timeseries")
    assert (existing["x"], existing["y"], existing["w"], existing["h"]) == (30, 5, 12, 6)
