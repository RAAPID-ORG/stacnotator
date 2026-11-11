"""Custom index expressions: the grammar, rendering, the Earth Engine adapter,
the schemas and the service check, all without a database or Earth Engine."""

import math

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src.timeseries import fetch
from src.timeseries.expressions import (
    MAX_EXPRESSION_LENGTH,
    ExpressionError,
    compile_expression,
    custom_index,
)
from src.timeseries.indices import INDICES_BY_KEY, render_formula
from src.timeseries.schemas import CustomIndexIn, CustomIndexOut
from src.timeseries.service import _series_index

BANDS = {
    "blue": 0.02,
    "green": 0.05,
    "red": 0.04,
    "rededge1": 0.12,
    "nir": 0.40,
    "nir08": 0.42,
    "swir1": 0.20,
    "swir2": 0.10,
}


def evaluate(expression: str) -> float:
    return compile_expression(expression)[1](BANDS)


def rendered(expression: str) -> str:
    return render_formula(custom_index("X", expression, (0, 1), ()))


class TestGrammarAccepted:
    def test_custom_ndvi_matches_the_built_in(self):
        built_in = INDICES_BY_KEY["NDVI"].formula(BANDS)
        assert evaluate("(nir - red) / (nir + red)") == pytest.approx(built_in)

    @pytest.mark.parametrize(
        ("expression", "expected"),
        [
            ("sqrt(nir)", math.sqrt(0.4)),
            ("abs(red - nir)", 0.36),
            ("log(nir)", math.log(0.4)),
            ("exp(red)", math.exp(0.04)),
            ("min(nir, red)", 0.04),
            ("max(nir, red)", 0.40),
            ("clamp(nir, 0.1, 0.3)", 0.3),
            ("where(nir > 0.3, nir, 0)", 0.40),
            ("where(nir > 0.5, nir, 0)", 0.0),
            ("nir ** 2", 0.16),
            ("-nir + 1", 0.6),
            ("nir >= 0.4", 1.0),
            ("nir < red", 0.0),
            ("0.2 < nir", 1.0),
        ],
    )
    def test_evaluates_on_floats(self, expression, expected):
        assert evaluate(expression) == pytest.approx(expected)

    def test_roles_are_in_first_appearance_order_without_duplicates(self):
        roles, _ = compile_expression("(red - nir) / (red + nir + blue)")
        assert roles == ("red", "nir", "blue")


class TestGrammarRejected:
    @pytest.mark.parametrize(
        "expression",
        [
            "nir.__class__",
            "__import__('os')",
            "lambda: nir",
            "nir[0]",
            "'nir'",
            "True",
            "NIR",
            "foo",
            "bar(nir)",
            "sqrt(nir, red)",
            "sqrt(x=nir)",
            "0 < nir < 1",
            "nir == red",
            "sqrt",
            "1 + 2",
            "nir +",
            "nir" + " " * MAX_EXPRESSION_LENGTH,
            "+".join(["nir"] * 40),
            "1" + "0" * 400,
        ],
    )
    def test_is_refused(self, expression):
        with pytest.raises(ExpressionError):
            compile_expression(expression)


class TestRendering:
    @pytest.mark.parametrize(
        ("expression", "text"),
        [
            ("(nir - red) / (nir + red)", "(NIR - Red) / (NIR + Red)"),
            ("nir - (red - blue)", "NIR - (Red - Blue)"),
            ("(nir - red) - blue", "NIR - Red - Blue"),
            ("nir ** red ** 2", "NIR ** Red ** 2"),
            ("(nir ** red) ** 2", "(NIR ** Red) ** 2"),
            ("-(nir + red)", "-(NIR + Red)"),
            ("sqrt(nir) * 2", "sqrt(NIR) * 2"),
            ("where(nir > 0.3, nir, 0)", "where(NIR > 0.3, NIR, 0)"),
            ("0.2 < nir", "NIR > 0.2"),
        ],
    )
    def test_formula_text_keeps_the_meaning(self, expression, text):
        assert rendered(expression) == text


class _FakeBand:
    """A single-band ee.Image stand-in that computes real numbers."""

    def __init__(self, value):
        self.value = float(value)

    @staticmethod
    def _v(other):
        return other.value if isinstance(other, _FakeBand) else other

    def add(self, o):
        return _FakeBand(self.value + self._v(o))

    def subtract(self, o):
        return _FakeBand(self.value - self._v(o))

    def multiply(self, o):
        return _FakeBand(self.value * self._v(o))

    def divide(self, o):
        return _FakeBand(self.value / self._v(o))

    def pow(self, o):
        return _FakeBand(self.value ** self._v(o))

    def gt(self, o):
        return _FakeBand(self.value > self._v(o))

    def gte(self, o):
        return _FakeBand(self.value >= self._v(o))

    def lt(self, o):
        return _FakeBand(self.value < self._v(o))

    def lte(self, o):
        return _FakeBand(self.value <= self._v(o))

    def sqrt(self):
        return _FakeBand(math.sqrt(self.value))

    def abs(self):
        return _FakeBand(abs(self.value))

    def log(self):
        return _FakeBand(math.log(self.value))

    def exp(self):
        return _FakeBand(math.exp(self.value))

    def min(self, o):
        return _FakeBand(min(self.value, self._v(o)))

    def max(self, o):
        return _FakeBand(max(self.value, self._v(o)))

    def where(self, test, value):
        return _FakeBand(self._v(value) if test.value else self.value)

    def mask(self):
        return self

    def updateMask(self, _mask):  # noqa: N802 - the Earth Engine method name
        return self

    def rename(self, _name):
        return self


class _FakeEeImage:
    """Replaces ee.Image: callable like the constructor, with .constant."""

    def __call__(self, value):
        return value if isinstance(value, _FakeBand) else _FakeBand(value)

    constant = __call__


class _FakeImage:
    def select(self, role):
        return _FakeBand(BANDS[role])


class TestEarthEngineAdapter:
    @pytest.mark.parametrize(
        "expression",
        ["where(nir > 0.3, sqrt(nir), 0)", "clamp(0.1 - nir ** 2, -0.05, 0.05) * max(red, 0.1)"],
    )
    def test_matches_the_plain_float_result(self, monkeypatch, expression):
        monkeypatch.setattr(fetch.ee, "Image", _FakeEeImage())
        index = custom_index("X", expression, (0, 1), ())
        built = fetch.index_image(_FakeImage(), index)
        assert built.value == pytest.approx(index.formula(BANDS))


def _draft(**overrides):
    fields = {"name": "MyIdx", "expression": " nir - red ", "domain_min": 0, "domain_max": 1}
    return CustomIndexIn(**{**fields, **overrides})


class TestSchemas:
    @pytest.mark.parametrize("name", ["ndvi", "Ndvi", "9lives", "my index", "a" * 25])
    def test_bad_names_are_rejected(self, name):
        with pytest.raises(ValidationError):
            _draft(name=name)

    def test_domain_must_be_ordered(self):
        with pytest.raises(ValidationError):
            _draft(domain_min=1, domain_max=1)

    def test_bad_expression_message_surfaces(self):
        with pytest.raises(ValidationError, match="Unknown band 'foo'"):
            _draft(expression="foo + 1")

    def test_expression_is_stripped(self):
        assert _draft().expression == "nir - red"

    def test_out_lists_only_sources_with_every_band(self):
        out = CustomIndexOut.model_validate(_draft(expression="rededge1 / nir"))
        assert out.source_keys == ["SENTINEL2"]

    def test_out_lists_all_sources_for_common_bands(self):
        out = CustomIndexOut.model_validate(_draft())
        assert len(out.source_keys) == 3
        assert out.formula == "NIR - Red"


class TestSeriesIndex:
    def test_unknown_index_is_refused(self):
        with pytest.raises(HTTPException) as err:
            _series_index("SENTINEL2", "NOPE", {})
        assert err.value.status_code == 422

    def test_source_missing_the_bands_is_refused(self):
        custom = _draft(expression="rededge1 / nir").spectral_index
        with pytest.raises(HTTPException) as err:
            _series_index("MODIS", custom.key, {custom.key: custom})
        assert err.value.status_code == 422

    def test_built_in_and_custom_are_returned(self):
        custom = _draft().spectral_index
        assert _series_index("MODIS", "NDVI", {}).key == "NDVI"
        assert _series_index("MODIS", "MyIdx", {"MyIdx": custom}) is custom


@pytest.mark.parametrize(
    "expression",
    ["nir + 1 / 0", "nir + sqrt(-1)", "nir + exp(1000)", "nir + log(0)", "nir * (-1) ** 0.5"],
)
def test_constant_parts_that_cannot_be_computed_are_refused(expression):
    # They would otherwise save and then fail every time the index is rendered or run.
    with pytest.raises(ExpressionError):
        compile_expression(expression)


def test_a_negative_constant_base_keeps_its_brackets():
    index = custom_index("Neg", "(-2) ** (nir > 0.3)", (0.0, 1.0), ())
    assert render_formula(index) == "(-2) ** (NIR > 0.3)"
