"""The spectral indices a time series can plot, as pure data.

An index is a formula over band *roles* ("nir", "swir1") rather than sensor band
names, which is what lets one definition serve MODIS, Landsat and Sentinel-2 at
once, and what makes per-source availability derivable rather than a second
hand-written list: an index is offered by a source exactly when the source can
supply every role the index reads (see sources.py).

Formulas use only + - * / and constants, which is what lets the same callable be
evaluated three ways: on plain floats in the tests, on real imagery in production
(Earth Engine exposes band math as named methods rather than operators, so
fetch.py wraps its images to bridge the two), and on band names here, to render
the formula shown in the UI. Nothing in this module imports Earth Engine.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

BandRole = Literal["blue", "green", "red", "rededge1", "nir", "nir08", "swir1", "swir2"]

Bands = Mapping[BandRole, Any]
Formula = Callable[[Bands], Any]


def normalized_difference(a: BandRole, b: BandRole) -> Formula:
    """(a - b) / (a + b), the shape most of these indices share."""
    return lambda band: (band[a] - band[b]) / (band[a] + band[b])


@dataclass(frozen=True)
class SpectralIndex:
    """One index: how to compute it and how to plot it.

    Deliberately carries no prose about what the formula means - the rendered
    formula is shown instead, since it is the thing that is actually true.
    """

    key: str
    label: str
    roles: tuple[BandRole, ...]
    formula: Formula
    # Y-axis extent for the chart, chosen to fit the values this index actually
    # takes on rather than its theoretical range.
    domain: tuple[float, float]
    # Values worth a gridline, e.g. the land/water threshold for MNDWI.
    reference_lines: tuple[float, ...]


INDICES: tuple[SpectralIndex, ...] = (
    SpectralIndex(
        key="NDVI",
        label="NDVI",
        roles=("nir", "red"),
        formula=normalized_difference("nir", "red"),
        domain=(-0.2, 1.0),
        reference_lines=(0.25, 0.75),
    ),
    SpectralIndex(
        key="EVI2",
        label="EVI2",
        roles=("nir", "red"),
        formula=lambda band: (
            2.5 * (band["nir"] - band["red"]) / (band["nir"] + 2.4 * band["red"] + 1.0)
        ),
        domain=(-0.2, 1.0),
        reference_lines=(0.25, 0.75),
    ),
    SpectralIndex(
        key="GCVI",
        label="GCVI",
        roles=("nir", "green"),
        formula=lambda band: band["nir"] / band["green"] - 1.0,
        domain=(0.0, 10.0),
        reference_lines=(2.0, 6.0),
    ),
    SpectralIndex(
        key="NDMI",
        label="NDMI",
        roles=("nir", "swir1"),
        formula=normalized_difference("nir", "swir1"),
        domain=(-0.8, 0.8),
        reference_lines=(0.0,),
    ),
    SpectralIndex(
        key="TCW",
        label="Tasseled Cap Wetness",
        roles=("blue", "green", "red", "nir", "swir1", "swir2"),
        # Crist (1985) coefficients, derived for Landsat TM reflectance and
        # applied unchanged to the other sensors here, as LandTrendr does.
        formula=lambda band: (
            0.0315 * band["blue"]
            + 0.2021 * band["green"]
            + 0.3102 * band["red"]
            + 0.1594 * band["nir"]
            - 0.6806 * band["swir1"]
            - 0.6109 * band["swir2"]
        ),
        domain=(-0.5, 0.2),
        reference_lines=(0.0,),
    ),
    SpectralIndex(
        key="NBR",
        label="NBR",
        roles=("nir", "swir2"),
        formula=normalized_difference("nir", "swir2"),
        domain=(-0.8, 1.0),
        reference_lines=(0.0,),
    ),
    SpectralIndex(
        key="MNDWI",
        label="MNDWI",
        roles=("green", "swir1"),
        formula=normalized_difference("green", "swir1"),
        domain=(-1.0, 1.0),
        reference_lines=(0.0,),
    ),
    SpectralIndex(
        key="NDRE",
        label="NDRE",
        roles=("nir08", "rededge1"),
        formula=normalized_difference("nir08", "rededge1"),
        domain=(-0.2, 0.8),
        reference_lines=(0.2, 0.4),
    ),
)

INDICES_BY_KEY: dict[str, SpectralIndex] = {index.key: index for index in INDICES}


def index_for(key: str) -> SpectralIndex | None:
    """The index registered under `key`, or None. Matching is case- and
    padding-insensitive so a stored value survives hand-editing."""
    return INDICES_BY_KEY.get(key.strip().upper())


# ---------------------------------------------------------------------------
# Rendering a formula for display
# ---------------------------------------------------------------------------

ROLE_LABELS: dict[BandRole, str] = {
    "blue": "Blue",
    "green": "Green",
    "red": "Red",
    "rededge1": "RedEdge",
    "nir": "NIR",
    "nir08": "NIRnarrow",
    "swir1": "SWIR1",
    "swir2": "SWIR2",
}

_SUM, _PRODUCT, _ATOM = 1, 2, 3


@dataclass(frozen=True)
class _Term:
    """A partially rendered formula, carrying enough precedence to know when a
    sub-expression needs brackets.

    Evaluating a formula with these in place of band values renders the
    expression that actually runs, so the formula shown to a user cannot drift
    from the one computed for them.
    """

    text: str
    precedence: int

    def _bracketed(self, minimum: int) -> str:
        return f"({self.text})" if self.precedence < minimum else self.text

    @staticmethod
    def _of(value: Any) -> "_Term":
        return value if isinstance(value, _Term) else _Term(f"{value:g}", _ATOM)

    def _combine(self, other: Any, operator: str, precedence: int) -> "_Term":
        right = _Term._of(other)
        # Subtraction and division do not associate, so a right operand at the
        # same precedence keeps its brackets: a - (b - c) is not a - b - c.
        right_minimum = precedence + 1 if operator in "-/" else precedence
        return _Term(
            f"{self._bracketed(precedence)} {operator} {right._bracketed(right_minimum)}",
            precedence,
        )

    def __add__(self, other: Any) -> "_Term":
        return self._combine(other, "+", _SUM)

    def __sub__(self, other: Any) -> "_Term":
        return self._combine(other, "-", _SUM)

    def __mul__(self, other: Any) -> "_Term":
        return self._combine(other, "*", _PRODUCT)

    def __truediv__(self, other: Any) -> "_Term":
        return self._combine(other, "/", _PRODUCT)

    # The reflected forms cannot delegate to the plain ones even where the
    # operation commutes: the operands have to render in the order written.
    def __radd__(self, other: Any) -> "_Term":
        return _Term._of(other)._combine(self, "+", _SUM)

    def __rsub__(self, other: Any) -> "_Term":
        return _Term._of(other)._combine(self, "-", _SUM)

    def __rmul__(self, other: Any) -> "_Term":
        return _Term._of(other)._combine(self, "*", _PRODUCT)

    def __rtruediv__(self, other: Any) -> "_Term":
        return _Term._of(other)._combine(self, "/", _PRODUCT)


def render_formula(index: SpectralIndex) -> str:
    """The index's formula as text, written in band roles."""
    bands = {role: _Term(ROLE_LABELS[role], _ATOM) for role in index.roles}
    rendered: _Term = index.formula(bands)
    return rendered.text
