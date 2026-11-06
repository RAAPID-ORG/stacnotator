import asyncio
import time
from unittest.mock import Mock, call

import pytest
from fastapi import Request

from src.auth.providers import firebase


@pytest.mark.parametrize(
    "failure",
    [
        firebase.auth.RevokedIdTokenError("Session revoked"),
        firebase.auth.UserDisabledError("Account disabled"),
        RuntimeError("Firebase unavailable"),
    ],
    ids=["revoked", "disabled", "verification-unavailable"],
)
def test_previously_authenticated_tokens_are_reverified(monkeypatch, caplog, failure):
    decoded = {
        "uid": "user",
        "email": "user@example.com",
        "email_verified": True,
        "exp": time.time() + 3600,
    }
    verify = Mock(side_effect=[decoded, failure])
    monkeypatch.setattr(firebase.firebase_admin, "_apps", {"test": object()})
    monkeypatch.setattr(firebase.auth, "verify_id_token", verify)
    provider = firebase.FirebaseAuthProvider()
    request = Request({"type": "http", "headers": [(b"authorization", b"Bearer token")]})

    assert asyncio.run(provider.authenticate(request)) == {
        "uid": "user",
        "email": "user@example.com",
    }
    assert asyncio.run(provider.authenticate(request)) is None
    assert verify.call_args_list == [
        call("token", check_revoked=True),
        call("token", check_revoked=True),
    ]
    assert "Firebase authentication failed" in caplog.text
