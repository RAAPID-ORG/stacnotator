import pytest
import responses

from stacnotator._auth import SECURETOKEN_URL, FirebaseTokenProvider, NoneTokenProvider
from stacnotator.errors import AuthenticationError


def mint_response(id_token="id-1", refresh_token="r-token", expires_in="3600"):
    return {"id_token": id_token, "refresh_token": refresh_token, "expires_in": expires_in}


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@responses.activate
def test_mints_and_caches_id_token():
    responses.post(SECURETOKEN_URL, json=mint_response())
    provider = FirebaseTokenProvider("AIzaKey", "r-token", clock=FakeClock())

    assert provider.id_token() == "id-1"
    assert provider.id_token() == "id-1"
    assert len(responses.calls) == 1
    assert responses.calls[0].request.url.endswith("?key=AIzaKey")
    assert "grant_type=refresh_token" in responses.calls[0].request.body


@responses.activate
def test_remints_after_expiry():
    responses.post(SECURETOKEN_URL, json=mint_response(id_token="id-1"))
    responses.post(SECURETOKEN_URL, json=mint_response(id_token="id-2"))
    clock = FakeClock()
    provider = FirebaseTokenProvider("AIzaKey", "r-token", clock=clock)

    assert provider.id_token() == "id-1"
    clock.now += 3600
    assert provider.id_token() == "id-2"


@responses.activate
def test_invalidate_forces_remint():
    responses.post(SECURETOKEN_URL, json=mint_response(id_token="id-1"))
    responses.post(SECURETOKEN_URL, json=mint_response(id_token="id-2"))
    provider = FirebaseTokenProvider("AIzaKey", "r-token", clock=FakeClock())

    assert provider.id_token() == "id-1"
    provider.invalidate()
    assert provider.id_token() == "id-2"


@responses.activate
def test_rotation_callback_receives_new_refresh_token():
    responses.post(SECURETOKEN_URL, json=mint_response(refresh_token="r-token-2"))
    rotated = []
    provider = FirebaseTokenProvider(
        "AIzaKey", "r-token", on_rotate=rotated.append, clock=FakeClock()
    )

    provider.id_token()
    assert rotated == ["r-token-2"]


@responses.activate
def test_unchanged_refresh_token_does_not_fire_rotation():
    responses.post(SECURETOKEN_URL, json=mint_response(refresh_token="r-token"))
    rotated = []
    provider = FirebaseTokenProvider(
        "AIzaKey", "r-token", on_rotate=rotated.append, clock=FakeClock()
    )

    provider.id_token()
    assert rotated == []


@responses.activate
def test_rejected_refresh_token_raises_authentication_error():
    responses.post(SECURETOKEN_URL, json={"error": {"message": "TOKEN_EXPIRED"}}, status=400)
    provider = FirebaseTokenProvider("AIzaKey", "r-token", clock=FakeClock())

    with pytest.raises(AuthenticationError, match="log in again"):
        provider.id_token()


def test_none_provider_yields_no_token():
    provider = NoneTokenProvider()
    assert provider.id_token() is None
    provider.invalidate()
    assert provider.id_token() is None
