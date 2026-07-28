from abc import ABC, abstractmethod
from typing import NotRequired, TypedDict

from fastapi import Request


class AuthenticatedUser(TypedDict):
    """
    Normalized user data from external authentication provider.

    Provides a consistent interface regardless of the underlying
    authentication service (Firebase, Auth0, etc.).
    """

    uid: str
    email: str | None
    name: NotRequired[str]


class AuthProvider(ABC):
    """
    Abstract base class for external authentication providers.

    Should be used to add support for new authentication
    providers (e.g. when we switch to Azure etc).

    Attributes:
        name: Unique identifier for this auth provider
        bootstrap_roles: Roles granted automatically the first time a user
            registers through this provider (empty for providers where roles
            are assigned separately, e.g. by an admin).
    """

    name: str
    bootstrap_roles: tuple[str, ...] = ()

    @abstractmethod
    async def authenticate(self, request: Request) -> AuthenticatedUser | None:
        """
        Validate incoming request and extract authenticated user data.

        Should check for authentication tokens in headers or cookies
        and validate them with the external provider.

        Args:
            request: FastAPI request object

        Returns:
            Normalized user data if authentication succeeds, None otherwise
        """
        raise NotImplementedError
