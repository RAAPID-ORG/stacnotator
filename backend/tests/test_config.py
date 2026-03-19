"""Tests for Settings configuration.

Tests both clean-slate defaults (as if fresh deploy) and explicit overrides
(as would be set in Azure App Service environment variables).
"""

import os
from unittest.mock import patch

from src.config import Settings

# Keys that pydantic-settings may pick up from the real environment
_ENV_KEYS = [
    "CORS_ORIGINS",
    "FIREBASE_CREDENTIALS_PATH",
    "FIREBASE_CREDENTIALS",
    "EE_SERVICE_ACCOUNT",
    "EE_PRIVATE_KEY_PATH",
    "EE_PRIVATE_KEY",
    "AUTH_PROVIDER",
]

_DB_DEFAULTS = {
    "DBNAME": "testdb",
    "DBUSER": "testuser",
    "DBPASS": "testpass",
    "DBHOST": "localhost",
    "DBPORT": "5432",
}


def _make_settings(**overrides):
    """Build Settings isolated from real env vars and .env files."""
    base = {**_DB_DEFAULTS, **overrides}
    clean_env = {k: v for k, v in os.environ.items() if k not in _ENV_KEYS}
    with patch.dict(os.environ, clean_env, clear=True):
        return Settings(_env_file=None, **base)


def _make_settings_from_env(env_vars: dict):
    """Build Settings purely from environment variables, like Azure would."""
    full_env = {**_DB_DEFAULTS, **env_vars}
    with patch.dict(os.environ, full_env, clear=True):
        return Settings(_env_file=None)


class TestDatabaseURL:
    def test_basic_url(self):
        s = _make_settings()
        assert s.DATABASE_URL == "postgresql+psycopg2://testuser:testpass@localhost:5432/testdb"

    def test_special_characters_in_password(self):
        s = _make_settings(DBPASS="p@ss:word/slash")
        assert "p%40ss%3Aword%2Fslash" in s.DATABASE_URL

    def test_custom_scheme_and_driver(self):
        s = _make_settings(DBSCHEME="postgresql", DBDRIVER="asyncpg")
        assert s.DATABASE_URL.startswith("postgresql+asyncpg://")

    def test_production_like_url(self):
        s = _make_settings_from_env(
            {
                "DBNAME": "stacnotator_prod",
                "DBUSER": "admin_user",
                "DBPASS": "Str0ng!P@ss#2025",
                "DBHOST": "prod-db.postgres.database.azure.com",
                "DBPORT": "5432",
            }
        )
        assert "prod-db.postgres.database.azure.com" in s.DATABASE_URL
        assert "stacnotator_prod" in s.DATABASE_URL


class TestCORSOrigins:
    def test_comma_separated(self):
        s = _make_settings(CORS_ORIGINS="http://a.com, http://b.com")
        assert s.CORS_ORIGINS == ["http://a.com", "http://b.com"]

    def test_json_array(self):
        s = _make_settings(CORS_ORIGINS='["http://a.com","http://b.com"]')
        assert s.CORS_ORIGINS == ["http://a.com", "http://b.com"]

    def test_empty_string_returns_defaults(self):
        s = _make_settings(CORS_ORIGINS="  ")
        assert "http://localhost:3000" in s.CORS_ORIGINS
        assert "http://localhost:5173" in s.CORS_ORIGINS

    def test_single_origin(self):
        s = _make_settings(CORS_ORIGINS="https://myapp.com")
        assert s.CORS_ORIGINS == ["https://myapp.com"]

    def test_default_value(self):
        s = _make_settings()
        origins = s.CORS_ORIGINS
        assert "http://localhost:3000" in origins
        assert "http://localhost:5173" in origins

    def test_production_wildcard(self):
        s = _make_settings_from_env({"CORS_ORIGINS": "*"})
        assert s.CORS_ORIGINS == ["*"]

    def test_production_explicit_domain(self):
        s = _make_settings_from_env({"CORS_ORIGINS": "https://stacnotator.azurewebsites.net"})
        assert s.CORS_ORIGINS == ["https://stacnotator.azurewebsites.net"]


class TestOptionalFields:
    def test_defaults_are_none_on_clean_env(self):
        s = _make_settings()
        assert s.FIREBASE_CREDENTIALS is None
        assert s.FIREBASE_CREDENTIALS_PATH is None
        assert s.EE_SERVICE_ACCOUNT is None
        assert s.EE_PRIVATE_KEY is None

    def test_firebase_credentials_from_env(self):
        s = _make_settings_from_env(
            {
                "FIREBASE_CREDENTIALS_PATH": "/secrets/firebase.json",
                "FIREBASE_CREDENTIALS": '{"type":"service_account"}',
            }
        )
        assert s.FIREBASE_CREDENTIALS_PATH == "/secrets/firebase.json"
        assert s.FIREBASE_CREDENTIALS == '{"type":"service_account"}'

    def test_ee_credentials_from_env(self):
        s = _make_settings_from_env(
            {
                "EE_SERVICE_ACCOUNT": "my-sa@project.iam.gserviceaccount.com",
                "EE_PRIVATE_KEY": "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
            }
        )
        assert s.EE_SERVICE_ACCOUNT == "my-sa@project.iam.gserviceaccount.com"
        assert "BEGIN RSA PRIVATE KEY" in s.EE_PRIVATE_KEY

    def test_auth_provider_defaults_to_firebase(self):
        s = _make_settings()
        assert s.AUTH_PROVIDER == "firebase"

    def test_auth_provider_from_env(self):
        s = _make_settings_from_env({"AUTH_PROVIDER": "azure_ad"})
        assert s.AUTH_PROVIDER == "azure_ad"
