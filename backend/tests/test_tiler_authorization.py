"""Unified tiler registry + org-scoped tiler authorization. No DB / network.

Covers the security-critical decisions: which tilers exist and are default-access,
which tilers an organization may use, the up-front enforcement on imagery save, and
what the wizard is offered for a project.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from src.config import TilerCfg
from src.imagery import service
from src.imagery.schemas import (
    CollectionStacConfigCreate,
    NamedVizParamsCreate,
    VizParamsCreate,
)
from src.organizations.service import set_org_tilers
from src.projects.service import get_project_tilers
from src.stac_browser.router import _tiler_catalogs
from src.tilers import registry


def _settings(default="azure"):
    return SimpleNamespace(
        TILERS={
            "azure": TilerCfg(url="https://azure", allows_ingest=True),
            "tiler-gcp": TilerCfg(
                url="https://gcp", stac_url="https://gcp/stac", allows_ingest=False
            ),
        },
        DEFAULT_TILER=default,
    )


@pytest.fixture()
def settings(monkeypatch):
    """Patch get_settings everywhere the tiler logic reads it (azure=default, tiler-gcp=extra)."""
    s = _settings()
    monkeypatch.setattr(registry, "get_settings", lambda: s)
    monkeypatch.setattr(service, "get_settings", lambda: s)
    return s


# A freshly approved organization is seeded with the default tilers (MPC + the default hosted).
SEEDED = ("mpc", "azure")


def _org(names=SEEDED, allows_internal_storage=False):
    return SimpleNamespace(
        allowed_tiler_names=list(names),
        allows_internal_storage=allows_internal_storage,
    )


MPC_CATALOG = "https://planetarycomputer.microsoft.com/api/stac/v1"
OTHER_CATALOG = "https://earth-search.example/v1"


def _editor_state(tiler, catalog_url=OTHER_CATALOG, viz=None, cover_viz=None):
    """One collection with one visualization. Default viz is first-valid compositing,
    i.e. MPC-eligible - so the catalog URL alone decides the routing."""
    stac = CollectionStacConfigCreate(
        catalog_url=catalog_url,
        tiler=tiler,
        visualizations=[
            NamedVizParamsCreate(
                name="rgb",
                viz_params=viz or VizParamsCreate(compositing="first"),
                cover_viz_params=cover_viz,
            )
        ],
    )
    col = SimpleNamespace(name="c1", stac_config=stac)
    return SimpleNamespace(sources=[SimpleNamespace(collections=[col])])


# --- registry -------------------------------------------------------------------


def test_registry_lists_mpc_and_hosted_with_flags(settings):
    by_name = {t.name: t for t in registry.all_tilers()}
    assert set(by_name) == {"mpc", "azure", "tiler-gcp"}
    assert by_name["mpc"].kind == "mpc"
    assert by_name["mpc"].default_access and not by_name["mpc"].is_default
    assert by_name["azure"].kind == "hosted"
    assert by_name["azure"].is_default and by_name["azure"].default_access
    assert by_name["tiler-gcp"].kind == "hosted"
    assert not by_name["tiler-gcp"].is_default and not by_name["tiler-gcp"].default_access


def test_registry_default_access_and_all_names(settings):
    assert registry.default_access_names() == {"mpc", "azure"}  # seeded for new orgs
    assert set(registry.all_names()) == {"mpc", "azure", "tiler-gcp"}
    assert registry.is_known("tiler-gcp")
    assert not registry.is_known("nope")


def test_registry_browsable_tilers(settings):
    # MPC (always) + tiler-gcp (has stac_url); azure is the default but has no stac_url.
    assert {t.name for t in registry.browsable_tilers()} == {"mpc", "tiler-gcp"}


# --- catalog injection (platform tiler catalogs in the wizard) ------------------


def test_tiler_catalogs_excludes_mpc_and_unauthorized(settings):
    # MPC is a public catalog (not emitted here); tiler-gcp isn't allowed for a plain org.
    assert _tiler_catalogs(SEEDED) == []


def test_tiler_catalogs_includes_allowed(settings):
    cats = _tiler_catalogs(("mpc", "azure", "tiler-gcp"))
    assert len(cats) == 1
    cat = cats[0]
    assert cat["tiler_name"] == "tiler-gcp"
    assert cat["provided"] is True
    assert cat["is_mpc"] is False
    assert cat["url"] == "https://gcp/stac"


# --- project tiler options (the wizard's only tiler-discovery endpoint) ----------


def test_project_tilers_lists_only_the_org_allowlist(settings):
    out = get_project_tilers(SimpleNamespace(organization=_org()))
    assert [t.name for t in out.tilers] == ["mpc", "azure"]
    assert [t.is_default for t in out.tilers] == [False, True]
    assert out.tilers[1].url == "https://azure"
    assert out.allows_internal_storage is False


def test_project_tilers_reports_internal_storage_and_extra_grants(settings):
    out = get_project_tilers(
        SimpleNamespace(
            organization=_org(("mpc", "azure", "tiler-gcp"), allows_internal_storage=True)
        )
    )
    assert [t.name for t in out.tilers] == ["mpc", "azure", "tiler-gcp"]
    assert out.allows_internal_storage is True


# --- _authorize_tilers (enforcement on save) ------------------------------------


def test_authorize_allows_default_and_none(settings):
    service._authorize_tilers(_org(), _editor_state(None))
    service._authorize_tilers(_org(), _editor_state("azure"))


def test_authorize_blocks_tiler_outside_org_allowlist(settings):
    with pytest.raises(HTTPException) as exc:
        service._authorize_tilers(_org(), _editor_state("tiler-gcp"))
    assert exc.value.status_code == 403


def test_authorize_allows_granted_extra(settings):
    service._authorize_tilers(_org(("mpc", "azure", "tiler-gcp")), _editor_state("tiler-gcp"))


def test_authorize_rejects_unknown_tiler(settings):
    with pytest.raises(HTTPException) as exc:
        service._authorize_tilers(_org(), _editor_state("ghost"))
    assert exc.value.status_code == 400


def test_authorize_blocks_default_tiler_when_org_has_none(settings):
    with pytest.raises(HTTPException) as exc:
        service._authorize_tilers(_org(()), _editor_state(None))
    assert exc.value.status_code == 403


# --- _authorize_tilers: MPC routing (catalog URL + viz eligibility, not the tiler field) ---


def test_authorize_allows_mpc_collection_for_mpc_only_org(settings):
    # Pure MPC imagery never touches a hosted tiler, so an org allowed only 'mpc' can
    # configure it - the resolved default hosted tiler is irrelevant here.
    service._authorize_tilers(_org(("mpc",)), _editor_state(None, catalog_url=MPC_CATALOG))


def test_authorize_blocks_mpc_collection_when_org_lacks_mpc(settings):
    with pytest.raises(HTTPException) as exc:
        service._authorize_tilers(_org(("azure",)), _editor_state(None, catalog_url=MPC_CATALOG))
    assert exc.value.status_code == 403
    assert "mpc" in exc.value.detail


def test_authorize_checks_hosted_tiler_for_mpc_catalog_needing_compositing(settings):
    # Median compositing is not MPC-eligible: the collection routes to the hosted tiler,
    # so an MPC-only org is refused and the message names the hosted tiler.
    state = _editor_state(None, catalog_url=MPC_CATALOG, viz=VizParamsCreate(compositing="median"))
    with pytest.raises(HTTPException) as exc:
        service._authorize_tilers(_org(("mpc",)), state)
    assert exc.value.status_code == 403
    assert "azure" in exc.value.detail

    service._authorize_tilers(_org(("mpc", "azure")), state)


def test_authorize_checks_hosted_tiler_for_masked_cover_viz(settings):
    # The cover slice renders with cover_viz_params; masking there forces the hosted path
    # even though the main viz is MPC-eligible.
    state = _editor_state(
        None, catalog_url=MPC_CATALOG, cover_viz=VizParamsCreate(mask_layer="scl")
    )
    with pytest.raises(HTTPException) as exc:
        service._authorize_tilers(_org(("mpc",)), state)
    assert exc.value.status_code == 403
    assert "azure" in exc.value.detail


def test_authorize_ignores_non_stac_collections(settings):
    col = SimpleNamespace(name="manual", stac_config=None)
    es = SimpleNamespace(sources=[SimpleNamespace(collections=[col])])
    service._authorize_tilers(_org(), es)  # no raise


def test_authorize_allows_null_tiler_when_no_default_configured(monkeypatch):
    # MPC-only deployment (e.g. the dev stack): no hosted tiler configured, so a
    # Planetary Computer preset with tiler=None resolves to no tiler. MPC tiles are
    # served direct - there is nothing to authorize, so this must not 403.
    s = SimpleNamespace(TILERS={}, DEFAULT_TILER=None)
    monkeypatch.setattr(service, "get_settings", lambda: s)
    service._authorize_tilers(_org(("mpc",)), _editor_state(None))  # must not raise


# --- org allowlist editing (what a platform admin may grant) --------------------


def test_set_org_tilers_rejects_unknown_names(settings):
    with pytest.raises(HTTPException) as exc:
        set_org_tilers(MagicMock(), 1, ["azure", "ghost"])
    assert exc.value.status_code == 400
    assert "ghost" in exc.value.detail


def test_set_org_tilers_accepts_any_known_tiler(settings):
    db = MagicMock()
    set_org_tilers(db, 1, ["mpc", "azure", "tiler-gcp"])
    assert [call.args[0].tiler_name for call in db.add.call_args_list] == [
        "mpc",
        "azure",
        "tiler-gcp",
    ]
    db.commit.assert_called_once()
