from abc import ABC, abstractmethod
from typing import Optional

from fastapi import Request


class AuthenticatedUser(dict):
    """
    Normalized user data from external authentication provider.

    Provides a consistent interface regardless of the underlying
    authentication service (Firebase, Auth0, etc.).

    Attributes:
        uid: Unique identifier from the auth provider
        email: User's email address (optional)
    """

    uid: str
    email: Optional[str]


class AuthProvider(ABC):
    """
    Abstract base class for external authentication providers.

    Should be used to add support for new authentication
    providers (e.g. when we switch to Azure etc).

    Attributes:
        name: Unique identifier for this auth provider
    """

    name: str

    @abstractmethod
    async def authenticate(self, request: Request) -> Optional[AuthenticatedUser]:
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
