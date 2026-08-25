import json
import logging
import time
from collections import OrderedDict
from threading import Lock

import firebase_admin
from fastapi import Request
from firebase_admin import auth, credentials
from starlette.concurrency import run_in_threadpool

from src.auth.exceptions import ExternalAuthEmailNotVerified
from src.auth.providers.base import AuthenticatedUser, AuthProvider
from src.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


class _VerifiedTokenCache:
    """Remember the outcome of verifying an ID token, until that token expires.

    Verification is pure, so repeating it per request buys nothing - and one map
    viewport sends a dozen requests bearing the identical token. Entries never outlive
    the token's own `exp`, and the cache is bounded so a stream of distinct tokens
    cannot grow it without limit.
    """

    def __init__(self, max_entries: int = 2048):
        self._entries: OrderedDict[str, tuple[float, AuthenticatedUser]] = OrderedDict()
        self._max_entries = max_entries
        self._lock = Lock()

    def get(self, token: str) -> AuthenticatedUser | None:
        now = time.time()
        with self._lock:
            entry = self._entries.get(token)
            if entry is None:
                return None
            expires_at, user = entry
            if expires_at <= now:
                del self._entries[token]
                return None
            self._entries.move_to_end(token)
            return user

    def put(self, token: str, user: AuthenticatedUser, expires_at: float | None) -> None:
        # No expiry claim means we cannot bound the entry safely, so do not keep it.
        if not expires_at:
            return
        with self._lock:
            self._entries[token] = (float(expires_at), user)
            self._entries.move_to_end(token)
            while len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)


_verified_cache = _VerifiedTokenCache()


class FirebaseAuthProvider(AuthProvider):
    """
    Firebase Authentication provider implementation.

    Validates Firebase ID tokens from request headers or cookies.
    """

    name = "firebase"

    def __init__(self):
        """Initialize Firebase Admin SDK if not already initialized."""
        if not firebase_admin._apps:
            # Support both file path and direct JSON content
            if settings.FIREBASE_CREDENTIALS:
                # Direct JSON content from Key Vault secret
                cred_dict = json.loads(settings.FIREBASE_CREDENTIALS)
                cred = credentials.Certificate(cred_dict)
            elif settings.FIREBASE_CREDENTIALS_PATH:
                # File path (for local development)
                cred = credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
            else:
                raise RuntimeError(
                    "Either FIREBASE_CREDENTIALS or FIREBASE_CREDENTIALS_PATH must be set"
                )
            firebase_admin.initialize_app(cred)

    async def authenticate(self, request: Request) -> AuthenticatedUser | None:
        """
        Authenticate user via Firebase ID token.

        Checks for token in cookies (firebase_token) or Authorization header.
        Verifies the token with Firebase and returns normalized user data.

        Args:
            request: FastAPI request object

        Returns:
            Authenticated user data if token is valid, None otherwise
        """
        # Try cookie first
        token = request.cookies.get("firebase_token")

        # Fall back to Authorization header
        if not token:
            header = request.headers.get("Authorization")
            if header and header.startswith("Bearer "):
                token = header.split(" ")[1]

        if not token:
            return None

        cached = _verified_cache.get(token)
        if cached is not None:
            return cached

        try:
            decoded = await run_in_threadpool(auth.verify_id_token, token)

            # Verify email is present and verified
            email = decoded.get("email")
            email_verified = decoded.get("email_verified", False)
            if not email or not email_verified:
                raise ExternalAuthEmailNotVerified()

            verified: AuthenticatedUser = {
                "uid": decoded["uid"],
                "email": email,
            }
            _verified_cache.put(token, verified, expires_at=decoded.get("exp"))
            return verified
        except ExternalAuthEmailNotVerified:
            raise  # Re-raise so the dependency layer can return a specific 403
        except Exception as e:
            logger.warning("Firebase authentication failed: %s", e)
            return None
