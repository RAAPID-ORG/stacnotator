"""AES-256-GCM encryption for provider API keys at rest.

The 256-bit master key is read from ``Settings.APIKEY_ENCRYPTION_SECRET`` (base64 of 32
bytes); on Azure that App Setting is a Key Vault reference, so the real key lives in Key
Vault and never sits in plaintext config. Ciphertext is stored as
``base64(nonce ‖ ciphertext+tag)``. GCM authenticates, so tampering or a wrong key fails
decryption loudly rather than returning garbage.
"""

import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from src.config import get_settings

_NONCE_BYTES = 12


class DecryptionError(Exception):
    """Raised when ciphertext cannot be authenticated/decrypted (tampered or wrong key)."""


def _key() -> bytes:
    # Settings rejects anything that is not base64 of 32 bytes at startup, so by the time
    # a request reaches here the decode cannot fail.
    return base64.b64decode(get_settings().APIKEY_ENCRYPTION_SECRET)


def encrypt(plaintext: str) -> str:
    nonce = os.urandom(_NONCE_BYTES)
    ciphertext = AESGCM(_key()).encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ciphertext).decode()


def decrypt(token: str) -> str:
    key = _key()
    try:
        blob = base64.b64decode(token)
        nonce, ciphertext = blob[:_NONCE_BYTES], blob[_NONCE_BYTES:]
        plaintext = AESGCM(key).decrypt(nonce, ciphertext, None)
    except (InvalidTag, ValueError) as e:
        raise DecryptionError("Failed to decrypt provider API key") from e
    return plaintext.decode()
