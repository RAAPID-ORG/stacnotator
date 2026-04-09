from src.auth.providers.base import AuthProvider
from src.config import get_settings

settings = get_settings()


def get_auth_provider() -> AuthProvider:
    match settings.AUTH_PROVIDER:
        case "firebase":
            from src.auth.providers.firebase import FirebaseAuthProvider

            return FirebaseAuthProvider()
        case "local":
            from src.auth.providers.local import LocalAuthProvider

            return LocalAuthProvider()
        case _:
            raise RuntimeError("Unknown AUTH_PROVIDER")
