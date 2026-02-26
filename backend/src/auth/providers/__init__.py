from src.auth.providers.base import AuthProvider
from src.auth.providers.firebase import FirebaseAuthProvider
from src.config import get_settings

settings = get_settings()


def get_auth_provider() -> AuthProvider:
    match settings.AUTH_PROVIDER:
        case "firebase":
            return FirebaseAuthProvider()
        # in the future we could extend this e.g when we transition to Azure
        case _:
            raise RuntimeError("Unknown AUTH_PROVIDER")
