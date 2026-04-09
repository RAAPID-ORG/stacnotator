import logging

from fastapi import Request

from src.auth.providers.base import AuthenticatedUser, AuthProvider
from src.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


class LocalAuthProvider(AuthProvider):
    """
    Local authentication provider for single-user local development.

    Skips all token validation - every request is authenticated as the
    same local admin user. Must NOT be used in production.
    """

    name = "local"

    def __init__(self):
        if settings.ENVIRONMENT == "production":
            raise RuntimeError(
                "AUTH_PROVIDER=local cannot be used with ENVIRONMENT=production. "
                "Use 'firebase' or another provider for production deployments."
            )
        logger.warning(
            "LOCAL AUTH MODE: All requests authenticated as admin. Do NOT expose to a network."
        )

    async def authenticate(self, request: Request) -> AuthenticatedUser:
        return {"uid": "local-user", "email": "local@localhost"}
