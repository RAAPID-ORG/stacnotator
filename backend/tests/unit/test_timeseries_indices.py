"""The index formulas, checked on plain floats.

Index formulas are written to run on anything supporting + - * /, which is what
lets these tests evaluate the exact callable production uses against literature
values, with no Earth Engine anywhere.
"""

import pytest

from src.timeseries.indices import INDICES, INDICES_BY_KEY, index_for, render_formula
from src.timeseries.sources import (
    _LANDSAT_OFFSET,
    _LANDSAT_OLI_BANDS,
    _LANDSAT_SCALE,
    _MODIS_BANDS,
    _MODIS_SCALE,
    _S2_BANDS,
    _S2_SCALE,
    LANDSAT_MISSIONS,
    SOURCES_BY_KEY,
    _to_reflectance,
    indices_for_source,
    offers,
    source_for,
)

# A healthy vegetated pixel, in surface reflectance.
VEGETATION = {
    "blue": 0.02,
    "green": 0.05,
    "red": 0.04,
    "rededge1": 0.12,
    "nir": 0.40,
    "nir08": 0.42,
    "swir1": 0.20,
    "swir2": 0.10,
}

# Open water: high visible, near-zero NIR and SWIR.
WATER = {
    "blue": 0.08,
    "green": 0.09,
    "red": 0.06,
    "rededge1": 0.04,
    "nir": 0.02,
    "nir08": 0.02,
    "swir1": 0.01,
    "swir2": 0.01,
}


def evaluate(key: str, bands: dict) -> float:
    return INDICES_BY_KEY[key].formula(bands)


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("NDVI", 0.36 / 0.44),
        ("EVI2", 2.5 * 0.36 / 1.496),
        ("GCVI", 7.0),
        ("NDMI", 0.20 / 0.60),
        ("NBR", 0.30 / 0.50),
        ("MNDWI", -0.15 / 0.25),
        ("NDRE", 0.30 / 0.54),
        ("TCW", -0.110307),
    ],
)
def test_formula_matches_hand_computed_value(key, expected):
    assert evaluate(key, VEGETATION) == pytest.approx(expected)


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("NDVI", "(NIR - Red) / (NIR + Red)"),
        ("EVI2", "2.5 * (NIR - Red) / (NIR + 2.4 * Red + 1)"),
        ("GCVI", "NIR / Green - 1"),
        ("NDMI", "(NIR - SWIR1) / (NIR + SWIR1)"),
        ("NBR", "(NIR - SWIR2) / (NIR + SWIR2)"),
        ("MNDWI", "(Green - SWIR1) / (Green + SWIR1)"),
        ("NDRE", "(NIRnarrow - RedEdge) / (NIRnarrow + RedEdge)"),
        (
            "TCW",
            "0.0315 * Blue + 0.2021 * Green + 0.3102 * Red + 0.1594 * NIR "
            "- 0.6806 * SWIR1 - 0.6109 * SWIR2",
        ),
    ],
)
def test_rendered_formula_is_the_expression_that_runs(key, expected):
    # Rendering evaluates the same callable the app does, with band names in
    # place of values, so a formula edit that is not mirrored here shows up as a
    # failure rather than as a UI that quietly lies about the maths.
    assert render_formula(INDICES_BY_KEY[key]) == expected


class TestPhysicalBehaviour:
    """Sanity that is independent of the arithmetic: if any of these flip, the
    index is wired to the wrong bands even if the formula shape looks right."""

    def test_vegetation_is_green_and_water_is_not(self):
        assert evaluate("NDVI", VEGETATION) > 0.5
        assert evaluate("NDVI", WATER) < 0

    def test_mndwi_separates_water_from_land_at_zero(self):
        assert evaluate("MNDWI", WATER) > 0
        assert evaluate("MNDWI", VEGETATION) < 0

    def test_nbr_collapses_when_a_burn_raises_swir2(self):
        burned = {**VEGETATION, "nir": 0.15, "swir2": 0.30}
        assert evaluate("NBR", VEGETATION) > 0.5
        assert evaluate("NBR", burned) < 0

    def test_gcvi_keeps_climbing_where_ndvi_has_flattened(self):
        """The reason GCVI is offered at all: past canopy closure NDVI barely
        moves while GCVI still separates the two canopies."""
        dense = {**VEGETATION, "nir": 0.45, "green": 0.045}
        denser = {**VEGETATION, "nir": 0.50, "green": 0.035}
        ndvi_gain = evaluate("NDVI", denser) - evaluate("NDVI", dense)
        gcvi_gain = evaluate("GCVI", denser) - evaluate("GCVI", dense)
        assert ndvi_gain < 0.05
        assert gcvi_gain > 3.0

    def test_evi2_stays_below_ndvi_over_dense_canopy(self):
        assert evaluate("EVI2", VEGETATION) < evaluate("NDVI", VEGETATION)

    def test_tcw_orders_surfaces_by_wetness(self):
        """Wetness is the whole point: open water above vegetated ground, and
        dry bare soil below it. A sign slip in the SWIR terms inverts this."""
        bare = {"blue": 0.10, "green": 0.15, "red": 0.20, "nir": 0.28, "swir1": 0.35, "swir2": 0.30}
        assert evaluate("TCW", WATER) > evaluate("TCW", VEGETATION) > evaluate("TCW", bare)
        assert evaluate("TCW", WATER) > 0 > evaluate("TCW", VEGETATION)


class TestRegistry:
    def test_keys_are_unique_and_canonical(self):
        keys = [index.key for index in INDICES]
        assert len(keys) == len(set(keys))
        assert all(key == key.strip().upper() for key in keys)

    def test_lookup_ignores_case_and_padding(self):
        assert index_for(" ndvi ") is INDICES_BY_KEY["NDVI"]
        assert index_for("NOPE") is None

    @pytest.mark.parametrize("index", INDICES, ids=lambda i: i.key)
    def test_chart_domain_is_ordered_and_contains_its_reference_lines(self, index):
        low, high = index.domain
        assert low < high
        assert all(low <= line <= high for line in index.reference_lines)

    @pytest.mark.parametrize("index", INDICES, ids=lambda i: i.key)
    def test_every_index_is_computable_by_some_source(self, index):
        assert any(offers(source, index) for source in SOURCES_BY_KEY.values())


class TestAvailability:
    """Availability is derived from bands, never listed by hand - these pin the
    result of that derivation."""

    def _keys(self, source_key: str) -> set[str]:
        source = source_for(source_key)
        assert source is not None
        return {index.key for index in indices_for_source(source)}

    def test_sentinel2_offers_everything(self):
        assert self._keys("SENTINEL2") == {index.key for index in INDICES}

    def test_landsat_offers_everything_except_the_red_edge_index(self):
        assert self._keys("LANDSAT") == {"NDVI", "EVI2", "GCVI", "NDMI", "TCW", "NBR", "MNDWI"}

    def test_modis_is_limited_to_its_two_bands(self):
        assert self._keys("MODIS") == {"NDVI", "EVI2"}

    def test_landsat_missions_agree_on_their_roles(self):
        """The missions are merged into one series, so a band present on one
        generation and missing on another would silently truncate it."""
        role_sets = {frozenset(bands) for _, bands in LANDSAT_MISSIONS}
        assert len(role_sets) == 1

    def test_source_lookup_ignores_case_and_padding(self):
        assert source_for(" modis ") is SOURCES_BY_KEY["MODIS"]
        assert source_for("SENTINEL3") is None


class _FakeImage:
    """Just enough of ee.Image to follow the select/scale chain arithmetically."""

    def __init__(self, value: float):
        self.value = value

    def select(self, names, renamed=None):
        return _FakeImage(self.value)

    def multiply(self, factor):
        return _FakeImage(self.value * factor)

    def add(self, term):
        return _FakeImage(self.value + term)


class TestReflectanceScaling:
    """Every source hands the index formulas true surface reflectance. Normalized
    differences would survive a wrong scale, but EVI2 has an absolute constant in
    its denominator, so a bad factor here quietly biases it."""

    def test_landsat_applies_the_collection_2_scale_and_offset(self):
        scaled = _to_reflectance(
            _FakeImage(20000), _LANDSAT_OLI_BANDS, _LANDSAT_SCALE, _LANDSAT_OFFSET
        )
        assert scaled.value == pytest.approx(0.35)

    def test_sentinel2_divides_by_ten_thousand(self):
        assert _to_reflectance(_FakeImage(3500), _S2_BANDS, _S2_SCALE).value == pytest.approx(0.35)

    def test_modis_applies_its_own_scale(self):
        assert _to_reflectance(_FakeImage(3500), _MODIS_BANDS, _MODIS_SCALE).value == pytest.approx(
            0.35
        )
