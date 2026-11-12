"""Custom index formulas: the grammar, rendering, the Earth Engine adapter and the
series validation, without a database or Earth Engine."""

import math

import pytest
from pydantic import ValidationError

from src.timeseries import fetch
from src.timeseries.expressions import (
    MAX_EXPRESSION_LENGTH,
    ExpressionError,
    compile_expression,
    custom_index,
)
from src.timeseries.indices import INDICES_BY_KEY, render_formula
from src.timeseries.schemas import CustomIndexIn, TimeseriesCreate, custom_index_out

BANDS = {"blue": 0.02, "green": 0.05, "red": 0.04, "rededge1": 0.12, "nir": 0.40}


def evaluate(expression: str) -> float:
    return compile_expression(expression)[1](BANDS)


def test_custom_ndvi_matches_the_built_in():
    built_in = INDICES_BY_KEY["NDVI"].formula(BANDS)
    assert evaluate("(nir - red) / (nir + red)") == pytest.approx(built_in)


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("sqrt(nir)", math.sqrt(0.4)),
        ("abs(red - nir)", 0.36),
        ("max(nir, red) - min(nir, red)", 0.36),
        ("nir ** 2", 0.16),
        ("-nir + 1", 0.6),
    ],
)
def test_evaluates_on_floats(expression, expected):
    assert evaluate(expression) == pytest.approx(expected)


@pytest.mark.parametrize(
    "expression",
    [
        "nir.__class__",
        "__import__('os')",
        "nir[0]",
        "True",
        "foo",
        "sqrt(nir, red)",
        "nir > 0.3",
        "1 + 2",
        "nir +",
        "nir" + " " * MAX_EXPRESSION_LENGTH,
        "+".join(["nir"] * 40),
        # Constant parts run in plain Python on every read, so they must compute.
        "nir + 1 / 0",
        "nir + sqrt(-1)",
        "nir * exp(1000)",
        "nir + sqrt((-1) ** 0.5)",
    ],
)
def test_is_refused(expression):
    with pytest.raises(ExpressionError):
        compile_expression(expression)


@pytest.mark.parametrize(
    ("expression", "text"),
    [
        ("nir - (red - blue)", "NIR - (Red - Blue)"),
        ("(nir ** red) ** 2", "(NIR ** Red) ** 2"),
        ("(-2) ** nir", "(-2) ** NIR"),
        ("-(nir + red)", "-(NIR + Red)"),
        ("sqrt(nir) * 2", "sqrt(NIR) * 2"),
        ("nir * 1.23456789", "NIR * 1.23456789"),
    ],
)
def test_rendered_formula_keeps_the_meaning(expression, text):
    assert render_formula(custom_index("X", expression, 0, 1)) == text


class _FakeImage:
    """ee.Image stand-in that computes real numbers behind the same method names."""

    def __init__(self, value):
        self.value = getattr(value, "value", value)

    @classmethod
    def constant(cls, value):
        return cls(value)

    def _binary(self, other, op):
        return _FakeImage(op(self.value, getattr(other, "value", other)))

    def subtract(self, other):
        return self._binary(other, float.__sub__)

    def divide(self, other):
        return self._binary(other, float.__truediv__)

    def pow(self, other):
        return self._binary(other, float.__pow__)

    def max(self, other):
        return self._binary(other, max)

    def sqrt(self):
        return _FakeImage(math.sqrt(self.value))


def test_earth_engine_adapter_matches_the_float_result(monkeypatch):
    monkeypatch.setattr(fetch.ee, "Image", _FakeImage)
    expression = "sqrt(nir - red) / max(red, 0.1) ** 2 - 1"
    terms = {role: fetch._ImageTerm(_FakeImage(value)) for role, value in BANDS.items()}
    built = compile_expression(expression)[1](terms)
    assert built.image.value == pytest.approx(evaluate(expression))


def _series(**overrides):
    fields = {
        "name": "s",
        "start_ym": "202401",
        "end_ym": "202412",
        "data_source": "SENTINEL2",
        "ts_type": "CIre",
        "expression": "nir / rededge1 - 1",
        "domain_min": 0,
        "domain_max": 5,
    }
    return TimeseriesCreate(**{**fields, **overrides})


def test_a_series_carries_its_custom_index():
    assert _series().ts_type == "CIre"


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"ts_type": "ndvi"}, "built-in"),
        ({"ts_type": "my index"}, "letters"),
        ({"domain_min": 5}, "minimum"),
        ({"domain_max": None}, "minimum"),
        ({"data_source": "MODIS"}, "bands"),
        ({"expression": "foo"}, "Unknown band"),
    ],
)
def test_a_bad_custom_series_is_refused(overrides, message):
    with pytest.raises(ValidationError, match=message):
        _series(**overrides)


def test_preview_lists_the_sources_that_carry_its_bands():
    out = custom_index_out(
        CustomIndexIn(name="CIre", expression="nir / rededge1 - 1", domain_min=0, domain_max=5)
    )
    assert out.formula == "NIR / RedEdge1 - 1"
    assert out.source_keys == ["SENTINEL2"]
