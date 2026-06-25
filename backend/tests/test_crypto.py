"""AES-256-GCM provider-key encryption. No DB / network."""

import base64
from types import SimpleNamespace

import pytest

from src import crypto


def _key_settings(monkeypatch, key_bytes=b"k" * 32):
    key = base64.b64encode(key_bytes).decode()
    monkeypatch.setattr(
        crypto, "get_settings", lambda: SimpleNamespace(APIKEY_ENCRYPTION_SECRET=key)
    )


@pytest.fixture()
def key_settings(monkeypatch):
    _key_settings(monkeypatch)


def test_round_trip(key_settings):
    assert crypto.decrypt(crypto.encrypt("planet-secret")) == "planet-secret"


def test_ciphertext_hides_plaintext(key_settings):
    token = crypto.encrypt("planet-secret")
    assert "planet-secret" not in token
    assert b"planet-secret" not in base64.b64decode(token)


def test_distinct_nonces_make_distinct_ciphertext(key_settings):
    # Same input encrypted twice must differ (fresh random nonce each call).
    assert crypto.encrypt("same") != crypto.encrypt("same")


def test_tampered_ciphertext_raises(key_settings):
    raw = bytearray(base64.b64decode(crypto.encrypt("planet-secret")))
    raw[-1] ^= 0x01
    with pytest.raises(crypto.DecryptionError):
        crypto.decrypt(base64.b64encode(bytes(raw)).decode())


def test_wrong_key_raises(monkeypatch):
    _key_settings(monkeypatch, b"a" * 32)
    token = crypto.encrypt("secret")
    _key_settings(monkeypatch, b"b" * 32)
    with pytest.raises(crypto.DecryptionError):
        crypto.decrypt(token)


def test_bad_key_length_raises_value_error(monkeypatch):
    _key_settings(monkeypatch, b"tooshort")
    with pytest.raises(ValueError):
        crypto.encrypt("secret")
