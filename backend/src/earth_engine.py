import logging

import ee

from src.config import get_settings

logger = logging.getLogger(__name__)


def initialize_earth_engine() -> bool:
    """Initialize Earth Engine with the configured service account.

    Returns True if initialized, False if EE is unconfigured or init failed.
    Failure is non-fatal so the app runs without EE credentials - only
    EE-dependent endpoints (timeseries, embeddings) fail at call time, with a
    clearer error than a startup crash.
    """
    settings = get_settings()
    service_account = settings.EE_SERVICE_ACCOUNT
    private_key_path = settings.EE_PRIVATE_KEY_PATH
    private_key = settings.EE_PRIVATE_KEY

    if not service_account or (not private_key_path and not private_key):
        logger.warning(
            "Earth Engine not configured (EE_SERVICE_ACCOUNT and "
            "EE_PRIVATE_KEY[_PATH] required); EE-dependent features disabled"
        )
        return False

    try:
        if private_key:
            credentials = ee.ServiceAccountCredentials(service_account, key_data=private_key)
        else:
            credentials = ee.ServiceAccountCredentials(service_account, private_key_path)
        ee.Initialize(credentials)
        return True
    except Exception as exc:
        logger.warning(
            "Earth Engine initialization failed (%s); EE-dependent features disabled", exc
        )
        return False
