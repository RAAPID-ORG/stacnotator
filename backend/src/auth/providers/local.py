import logging

from fastapi import Request

from src.auth.providers.base import AuthenticatedUser, AuthProvider

logger = logging.getLogger(__name__)

LOCAL_USER: AuthenticatedUser = {"uid": "local-user", "email": "local@localhost"}


class LocalAuthProvider(AuthProvider):
    """
    Local authentication provider for single-user local development.

    Skips all token validation - every request is authenticated as the
    same local admin user. Must NOT be used in production.
    """

    name = "local"
    grants_platform_admin = True

    def __init__(self):
        logger.warning(
            "LOCAL AUTH MODE: All requests authenticated as admin. Do NOT expose to a network."
        )

    async def authenticate(self, request: Request) -> AuthenticatedUser:
        return LOCAL_USER
