import json
import logging

import firebase_admin
from fastapi import Request
from firebase_admin import auth, credentials
from starlette.concurrency import run_in_threadpool

from src.auth.providers.base import AuthenticatedUser, AuthProvider, ExternalAuthEmailNotVerified
from src.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


class FirebaseAuthProvider(AuthProvider):
    """
    Firebase Authentication provider implementation.

    Validates Firebase ID tokens from the Authorization header.
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

        Verifies the bearer token with Firebase and returns normalized user data.

        Args:
            request: FastAPI request object

        Returns:
            Authenticated user data if token is valid, None otherwise
        """
        header = request.headers.get("Authorization")
        if not header or not header.startswith("Bearer "):
            return None
        token = header.split(" ")[1]

        try:
            decoded = await run_in_threadpool(auth.verify_id_token, token, check_revoked=True)

            # Verify email is present and verified
            email = decoded.get("email")
            email_verified = decoded.get("email_verified", False)
            if not email or not email_verified:
                raise ExternalAuthEmailNotVerified()

            verified: AuthenticatedUser = {
                "uid": decoded["uid"],
                "email": email,
            }
            return verified
        except ExternalAuthEmailNotVerified:
            raise  # Re-raise so the dependency layer can return a specific 403
        except Exception as e:
            logger.warning("Firebase authentication failed: %s", e)
            return None
