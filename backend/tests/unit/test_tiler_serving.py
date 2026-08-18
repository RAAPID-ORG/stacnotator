from types import SimpleNamespace

from src.config import TilerCfg
from src.tilers import registry

MPC_URL = registry.MPC_STAC_URL
PLATFORM_STAC = "https://tiles.example.org/stac"


def _settings(tilers: dict[str, TilerCfg], default: str | None):
    return lambda: SimpleNamespace(TILERS=tilers, DEFAULT_TILER=default)


def _configure(monkeypatch, tilers: dict[str, TilerCfg], default: str | None = None):
    monkeypatch.setattr(registry, "get_settings", _settings(tilers, default))


PLATFORM = TilerCfg(url="https://tiles.example.org", stac_url=PLATFORM_STAC, allows_ingest=False)
INGESTING = TilerCfg(url="https://big.example.org", allows_ingest=True)


def test_no_hosted_tiler_serves_nothing(monkeypatch):
    _configure(monkeypatch, {})
    assert registry.serving_tiler(MPC_URL, None, ["mpc"]) is None


def test_platform_catalog_is_served_by_its_own_tiler(monkeypatch):
    _configure(monkeypatch, {"platform": PLATFORM})
    tiler = registry.serving_tiler(f"{PLATFORM_STAC}/collections", None, ["platform"])
    assert tiler is not None and tiler.name == "platform"


def test_external_catalog_needs_an_ingesting_tiler(monkeypatch):
    _configure(monkeypatch, {"platform": PLATFORM}, default="platform")
    assert registry.serving_tiler(MPC_URL, None, ["platform"]) is None


def test_external_catalog_switches_off_a_pin_that_cannot_ingest(monkeypatch):
    _configure(monkeypatch, {"platform": PLATFORM, "big": INGESTING}, default="platform")
    tiler = registry.serving_tiler(MPC_URL, "platform", ["platform", "big"])
    assert tiler is not None and tiler.name == "big"


def test_tilers_outside_the_allowlist_are_not_candidates(monkeypatch):
    _configure(monkeypatch, {"big": INGESTING})
    assert registry.serving_tiler(MPC_URL, None, ["mpc"]) is None
    assert registry.serving_tiler(MPC_URL, None, ["mpc", "big"]) is not None


def test_default_tiler_wins_among_ingesting_candidates(monkeypatch):
    other = TilerCfg(url="https://other.example.org", allows_ingest=True)
    _configure(monkeypatch, {"other": other, "big": INGESTING}, default="big")
    tiler = registry.serving_tiler("https://earth-search.aws", None, ["other", "big"])
    assert tiler is not None and tiler.name == "big"
