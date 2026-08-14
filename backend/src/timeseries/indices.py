"""The spectral indices a time series can plot, as pure data.

An index is a formula over band *roles* ("nir", "swir1") rather than sensor band
names, which is what lets one definition serve MODIS, Landsat and Sentinel-2 at
once, and what makes per-source availability derivable rather than a second
hand-written list: an index is offered by a source exactly when the source can
supply every role the index reads (see sources.py).

Formulas use only + - * / and constants, which is what lets the same callable be
evaluated on plain floats in the tests and on real imagery in production - Earth
Engine exposes band math as named methods rather than operators, so fetch.py
wraps its images to bridge the two. Nothing in this module imports Earth Engine.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

BandRole = Literal["green", "red", "rededge1", "nir", "nir08", "swir1", "swir2"]

Bands = Mapping[BandRole, Any]
Formula = Callable[[Bands], Any]


def normalized_difference(a: BandRole, b: BandRole) -> Formula:
    """(a - b) / (a + b), the shape most of these indices share."""
    return lambda band: (band[a] - band[b]) / (band[a] + band[b])


@dataclass(frozen=True)
class SpectralIndex:
    """One index: how to compute it, how to plot it, and what it is good for.

    The prose fields are shown to campaign designers when they pick an index and
    to annotators reading the chart, so they carry the honest limitation as well
    as the use case - a series people trust needs to say where it stops working.
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
    summary: str
    good_for: str
    caution: str
    citation: str


INDICES: tuple[SpectralIndex, ...] = (
    SpectralIndex(
        key="NDVI",
        label="NDVI",
        roles=("nir", "red"),
        formula=normalized_difference("nir", "red"),
        domain=(-0.2, 1.0),
        reference_lines=(0.25, 0.75),
        summary=(
            "Contrast between near-infrared and red reflectance, the standard "
            "measure of green vegetation cover."
        ),
        good_for=(
            "General land cover, vegetation presence and seasonality, clearing and "
            "regrowth. The safe default when no more specific index fits."
        ),
        caution=(
            "Saturates over dense canopy, so it flattens through peak growing season "
            "and cannot separate a good crop from an excellent one. Where cover is "
            "sparse it also responds to soil brightness."
        ),
        citation="Rouse et al., 1974",
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
        summary=(
            "A vegetation index tuned to keep responding where NDVI saturates, using "
            "only red and near-infrared."
        ),
        good_for=(
            "Peak-season crop and forest condition and phenology timing in dense "
            "canopy. Tracks the three-band EVI closely without needing a blue band, "
            "so it stays comparable across all three sources here."
        ),
        caution=(
            "Unlike a normalized difference this depends on correctly scaled surface "
            "reflectance, and residual haze moves it more than it moves NDVI."
        ),
        citation="Jiang et al., 2008",
    ),
    SpectralIndex(
        key="GCVI",
        label="GCVI",
        roles=("nir", "green"),
        formula=lambda band: band["nir"] / band["green"] - 1.0,
        domain=(0.0, 10.0),
        reference_lines=(2.0, 6.0),
        summary=(
            "Ratio of near-infrared to green reflectance, tracking canopy chlorophyll content."
        ),
        good_for=(
            "Crop condition and yield work, maize especially. Stays close to linear "
            "with green leaf area well past the point where NDVI stops responding, so "
            "it separates fields that NDVI shows as identical."
        ),
        caution=(
            "A ratio rather than a normalized difference, so it is unbounded above and "
            "more sensitive to atmospheric correction quality and viewing geometry. "
            "Healthy vegetation typically runs 2 to 8."
        ),
        citation="Gitelson et al., 2005",
    ),
    SpectralIndex(
        key="NDMI",
        label="NDMI",
        roles=("nir", "swir1"),
        formula=normalized_difference("nir", "swir1"),
        domain=(-0.8, 0.8),
        reference_lines=(0.0,),
        summary=(
            "Near-infrared against shortwave infrared, which responds to water content "
            "in vegetation and soil."
        ),
        good_for=(
            "Drought, irrigation and canopy water stress, and forest disturbance that "
            "thins a canopy without removing it. Often moves before NDVI does."
        ),
        caution=(
            "Cannot separate canopy moisture from soil moisture where vegetation cover is sparse."
        ),
        citation="Gao, 1996; Wilson & Sader, 2002",
    ),
    SpectralIndex(
        key="NBR",
        label="NBR",
        roles=("nir", "swir2"),
        formula=normalized_difference("nir", "swir2"),
        domain=(-0.8, 1.0),
        reference_lines=(0.0,),
        summary=(
            "Near-infrared against the longer shortwave infrared band, the standard "
            "pairing for burned and freshly cleared ground."
        ),
        good_for=(
            "Fire scars and burn severity, clearcuts, windthrow and other abrupt "
            "canopy loss. The step at the event is far larger than in NDVI."
        ),
        caution=(
            "Severity is normally read from the drop between a pre-event and a "
            "post-event value, not from a single reading."
        ),
        citation="Key & Benson, 2006",
    ),
    SpectralIndex(
        key="MNDWI",
        label="MNDWI",
        roles=("green", "swir1"),
        formula=normalized_difference("green", "swir1"),
        domain=(-1.0, 1.0),
        reference_lines=(0.0,),
        summary="Green against shortwave infrared, which separates open water from land.",
        good_for=(
            "Water extent, flooding, seasonal wetlands and reservoir levels. Values "
            "above zero generally indicate water, and it holds that split over "
            "built-up ground better than the older green/NIR version."
        ),
        caution=(
            "Optical sensors cannot see through cloud, so flood peaks are often missed "
            "entirely. Wet soil and dark surfaces also push values up."
        ),
        citation="Xu, 2006",
    ),
    SpectralIndex(
        key="NDRE",
        label="NDRE",
        roles=("nir08", "rededge1"),
        formula=normalized_difference("nir08", "rededge1"),
        domain=(-0.2, 0.8),
        reference_lines=(0.2, 0.4),
        summary=(
            "Near-infrared against the red edge, sensitive to chlorophyll "
            "concentration rather than to green cover alone."
        ),
        good_for=(
            "Crop nitrogen status and early stress in closed canopy, where it responds "
            "while NDVI is still saturated."
        ),
        caution=(
            "Sentinel-2 only, since no other source here carries a red edge band. "
            "Computed at 20 m from the narrow near-infrared band so both inputs share "
            "a resolution and a viewing geometry."
        ),
        citation="Gitelson & Merzlyak, 1994; Barnes et al., 2000",
    ),
)

INDICES_BY_KEY: dict[str, SpectralIndex] = {index.key: index for index in INDICES}


def index_for(key: str) -> SpectralIndex | None:
    """The index registered under `key`, or None. Matching is case- and
    padding-insensitive so a stored value survives hand-editing."""
    return INDICES_BY_KEY.get(key.strip().upper())
