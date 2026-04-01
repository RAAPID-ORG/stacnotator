import json
import logging

import firebase_admin
from fastapi import Request
from firebase_admin import auth, credentials

from src.auth.exceptions import ExternalAuthEmailNotVerified
from src.auth.providers.base import AuthenticatedUser, AuthProvider
from src.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


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

        try:
            decoded = auth.verify_id_token(token)

            # Verify email is present and verified
            email = decoded.get("email")
            email_verified = decoded.get("email_verified", False)
            if not email or not email_verified:
                raise ExternalAuthEmailNotVerified()

            return {
                "uid": decoded["uid"],
                "email": email,
            }
        except Exception as e:
            logger.warning(f"Firebase authentication failed: {e}")
            return None
