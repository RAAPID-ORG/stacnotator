"""MPC SAS token management with retry logic."""

import logging
import time

import planetary_computer as pc

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_DELAY = 1.0


def sign_item(item):
    """Sign a STAC item with MPC SAS token, with retry for flakiness."""
    for attempt in range(MAX_RETRIES):
        try:
            return pc.sign(item)
        except Exception as e:
            logger.warning("MPC sign attempt %d failed: %s", attempt + 1, e)
            if attempt == MAX_RETRIES - 1:
                raise
            time.sleep(RETRY_DELAY)


def is_planetary_computer(url: str) -> bool:
    """Check if a URL belongs to Microsoft Planetary Computer."""
    return "planetarycomputer.microsoft.com" in url
