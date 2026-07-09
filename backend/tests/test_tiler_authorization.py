"""Unified tiler registry + per-user tiler authorization. No DB / network.

Covers the security-critical decisions: which tilers exist and are default-access,
whether a user may use a given tiler, the up-front enforcement on imagery save, and
what an admin may grant.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

import src.auth.models as auth_models
from src.auth import router as auth_router
from src.auth.models import User, UserTiler
from src.auth.service import grant_tiler, revoke_tiler
from src.config import TilerCfg
from src.imagery import service
from src.tiling import registry
from src.tiling.router import _tiler_catalogs


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
    monkeypatch.setattr(auth_models, "get_settings", lambda: s)
    return s


# A freshly-registered user is seeded with the default tilers (MPC + the default hosted).
SEEDED = ("mpc", "azure")


def _user(names=SEEDED):
    u = User()
    u.tilers = [UserTiler(tiler_name=n) for n in names]
    return u


def _editor_state(tiler, catalog_url="https://earth-search.example/v1"):
    col = SimpleNamespace(
        name="c1", stac_config=SimpleNamespace(catalog_url=catalog_url, tiler=tiler)
    )
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
    assert registry.default_access_names() == {"mpc", "azure"}  # seeded for new users
    assert set(registry.all_names()) == {"mpc", "azure", "tiler-gcp"}
    assert registry.is_known("tiler-gcp")
    assert not registry.is_known("nope")


def test_registry_browsable_tilers(settings):
    # MPC (always) + tiler-gcp (has stac_url); azure is the default but has no stac_url.
    assert {t.name for t in registry.browsable_tilers()} == {"mpc", "tiler-gcp"}


# --- catalog injection (platform tiler catalogs in the wizard) ------------------


def test_tiler_catalogs_excludes_mpc_and_unauthorized(settings):
    # MPC is a public catalog (not emitted here); tiler-gcp isn't granted to a plain user.
    assert _tiler_catalogs(_user()) == []


def test_tiler_catalogs_includes_granted(settings):
    cats = _tiler_catalogs(_user(("mpc", "azure", "tiler-gcp")))
    assert len(cats) == 1
    cat = cats[0]
    assert cat["tiler_name"] == "tiler-gcp"
    assert cat["provided"] is True
    assert cat["is_mpc"] is False
    assert cat["url"] == "https://gcp/stac"


# --- User.can_use_tiler (membership in the seeded/granted set) ------------------


def test_can_use_tiler_seeded_defaults(settings):
    u = _user()  # seeded with mpc + azure
    assert u.can_use_tiler(None)  # null => default selection
    assert u.can_use_tiler("azure")
    assert u.can_use_tiler("mpc")
    assert not u.can_use_tiler("tiler-gcp")  # not granted


def test_can_use_tiler_after_grant(settings):
    u = _user(("mpc", "azure", "tiler-gcp"))
    assert u.can_use_tiler("tiler-gcp")
    assert u.allowed_tilers == ["mpc", "azure", "tiler-gcp"]


def test_can_use_tiler_none_when_no_tilers(settings):
    u = _user(())
    assert not u.can_use_tiler("mpc")
    assert not u.can_use_tiler(None)


# --- _authorize_tilers (enforcement on save) ------------------------------------


def test_authorize_allows_default_and_none(settings):
    service._authorize_tilers(_user(), _editor_state(None))
    service._authorize_tilers(_user(), _editor_state("azure"))


def test_authorize_blocks_ungranted_extra(settings):
    with pytest.raises(HTTPException) as exc:
        service._authorize_tilers(_user(), _editor_state("tiler-gcp"))
    assert exc.value.status_code == 403


def test_authorize_allows_granted_extra(settings):
    service._authorize_tilers(_user(("mpc", "azure", "tiler-gcp")), _editor_state("tiler-gcp"))


def test_authorize_rejects_unknown_tiler(settings):
    with pytest.raises(HTTPException) as exc:
        service._authorize_tilers(_user(), _editor_state("ghost"))
    assert exc.value.status_code == 400


def test_authorize_ignores_non_stac_collections(settings):
    col = SimpleNamespace(name="manual", stac_config=None)
    es = SimpleNamespace(sources=[SimpleNamespace(collections=[col])])
    service._authorize_tilers(_user(), es)  # no raise


def test_authorize_allows_null_tiler_when_no_default_configured(monkeypatch):
    # MPC-only deployment (e.g. the dev stack): no hosted tiler configured, so a
    # Planetary Computer preset with tiler=None resolves to no tiler. MPC tiles are
    # served direct — there is nothing to authorize, so this must not 403.
    s = SimpleNamespace(TILERS={}, DEFAULT_TILER=None)
    monkeypatch.setattr(service, "get_settings", lambda: s)
    monkeypatch.setattr(auth_models, "get_settings", lambda: s)
    service._authorize_tilers(_user(("mpc",)), _editor_state(None))  # must not raise


# --- admin grant validation -----------------------------------------------------


def test_validate_grantable_rejects_unknown(settings):
    with pytest.raises(HTTPException) as exc:
        auth_router._validate_grantable_tiler("ghost")
    assert exc.value.status_code == 400


def test_validate_grantable_accepts_any_known_tiler(settings):
    for name in ("mpc", "azure", "tiler-gcp"):
        auth_router._validate_grantable_tiler(name)  # no raise


# --- grant/revoke service (idempotent; not-found) -------------------------------


def test_grant_tiler_adds_when_absent():
    db = MagicMock()
    user = object()
    db.get.side_effect = [user, None]  # user exists; no existing grant row
    assert grant_tiler(db, "uid", "tiler-gcp") is user
    db.add.assert_called_once()
    db.commit.assert_called_once()


def test_grant_tiler_is_idempotent_when_present():
    db = MagicMock()
    user = object()
    db.get.side_effect = [user, UserTiler(tiler_name="tiler-gcp")]  # grant already exists
    assert grant_tiler(db, "uid", "tiler-gcp") is user
    db.add.assert_not_called()
    db.commit.assert_not_called()


def test_grant_tiler_returns_none_for_missing_user():
    db = MagicMock()
    db.get.side_effect = [None]
    assert grant_tiler(db, "uid", "tiler-gcp") is None
    db.add.assert_not_called()


def test_revoke_tiler_deletes_when_present():
    db = MagicMock()
    user = object()
    row = UserTiler(tiler_name="tiler-gcp")
    db.get.side_effect = [user, row]
    assert revoke_tiler(db, "uid", "tiler-gcp") is user
    db.delete.assert_called_once_with(row)


def test_revoke_tiler_noop_when_absent():
    db = MagicMock()
    user = object()
    db.get.side_effect = [user, None]
    assert revoke_tiler(db, "uid", "tiler-gcp") is user
    db.delete.assert_not_called()
