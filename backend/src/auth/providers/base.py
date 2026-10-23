from abc import ABC, abstractmethod
from typing import TypedDict

from fastapi import Request


class AuthenticatedUser(TypedDict):
    """Normalized user data from the authentication provider."""

    uid: str
    email: str | None


class ExternalAuthEmailNotVerified(Exception):
    def __init__(self, message: str = "Email address is not verified with the auth provider"):
        super().__init__(message)


class AuthProvider(ABC):
    """
    An authentication backend, selected by AUTH_PROVIDER.

    Attributes:
        name: Unique identifier for this auth provider, stored as the user's issuer
        grants_platform_admin: Whether a user registering through this provider
            becomes a platform admin (only the single-user local provider)
    """

    name: str
    grants_platform_admin: bool = False

    @abstractmethod
    async def authenticate(self, request: Request) -> AuthenticatedUser | None:
        """
        Validate incoming request and extract authenticated user data.

        Should read the bearer token and validate it with the provider.

        Args:
            request: FastAPI request object

        Returns:
            Normalized user data if authentication succeeds, None otherwise
        """
        raise NotImplementedError
