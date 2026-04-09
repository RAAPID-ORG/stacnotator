"""pystac_client wrapper with MPC signing support."""

import logging

import planetary_computer as pc
import pystac_client

logger = logging.getLogger(__name__)


def is_planetary_computer(url: str) -> bool:
    return "planetarycomputer.microsoft.com" in url


def get_client(catalog_url: str) -> pystac_client.Client:
    """Get a pystac Client for the given catalog URL."""
    kwargs = {}
    if is_planetary_computer(catalog_url):
        kwargs["modifier"] = pc.sign_inplace
    return pystac_client.Client.open(catalog_url, **kwargs)
