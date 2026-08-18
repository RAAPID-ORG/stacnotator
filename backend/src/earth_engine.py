import logging
import threading
import time

import ee

from src.config import get_settings

logger = logging.getLogger(__name__)

# Gunicorn recycles workers after max-requests, and every fresh worker
# re-initializes Earth Engine. A transient network or auth failure at that
# moment must not disable EE for the worker's whole lifetime, so a failed init
# is retried on the next EE-dependent call - at most this often, to keep a
# hard outage from adding a slow init roundtrip to every request.
_RETRY_COOLDOWN_SECONDS = 30.0

_lock = threading.Lock()
_ready = False
_last_attempt: float | None = None


def _is_configured() -> bool:
    settings = get_settings()
    return bool(
        settings.EE_SERVICE_ACCOUNT and (settings.EE_PRIVATE_KEY_PATH or settings.EE_PRIVATE_KEY)
    )


def _try_initialize() -> bool:
    settings = get_settings()
    try:
        if settings.EE_PRIVATE_KEY:
            credentials = ee.ServiceAccountCredentials(
                settings.EE_SERVICE_ACCOUNT, key_data=settings.EE_PRIVATE_KEY
            )
        else:
            credentials = ee.ServiceAccountCredentials(
                settings.EE_SERVICE_ACCOUNT, settings.EE_PRIVATE_KEY_PATH
            )
        ee.Initialize(credentials)
        return True
    except Exception as exc:
        logger.warning(
            "Earth Engine initialization failed (%s); will retry on the next EE request", exc
        )
        return False


def initialize_earth_engine() -> bool:
    """Warm up Earth Engine at application startup.

    Returns True if initialized, False if EE is unconfigured or init failed.
    Failure is non-fatal so the app runs without EE credentials - EE-dependent
    endpoints (timeseries, embeddings) gate on ensure_earth_engine at call
    time, which also retries an init that failed here.
    """
    if not _is_configured():
        logger.warning(
            "Earth Engine not configured (EE_SERVICE_ACCOUNT and "
            "EE_PRIVATE_KEY[_PATH] required); EE-dependent features disabled"
        )
        return False
    return ensure_earth_engine()


def ensure_earth_engine() -> bool:
    """True when Earth Engine is usable in this process.

    Call before any EE-dependent work. Retries a previously failed init once
    the cooldown has passed; an unconfigured deployment never retries.
    """
    global _ready, _last_attempt
    if _ready:
        return True
    if not _is_configured():
        return False
    with _lock:
        if _ready:
            return True
        now = time.monotonic()
        if _last_attempt is not None and now - _last_attempt < _RETRY_COOLDOWN_SECONDS:
            return False
        _last_attempt = now
        _ready = _try_initialize()
    return _ready
