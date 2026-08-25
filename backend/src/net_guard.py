"""SSRF guard for outbound fetches whose target a user can influence.

Validating a URL up front is not enough: the name can resolve to a public address
for the check and an internal one for the connect (DNS rebinding), a redirect can
move the request to a new host, and fetched content (a STAC catalog's ``next`` link,
an item href) decides what gets fetched after it. So the guard sits on the
*connection*: every request an httpx client makes through :func:`guarded_client` -
first hop and each redirect alike - has its scheme checked, its host resolved, every
answer rejected if it is private/loopback/link-local, and the socket pinned to the
address that was validated. TLS still verifies against the original hostname.

There are no exempt hosts, because an exemption can only be keyed on the URL and
the URL cannot say who chose it - a host we configured and a host a user typed are
the same string. Calls to our own services carry no user input and do not come
through here at all (see ``tilers/providers.py``); everything that does reach this
module is untrusted by definition, so all of it is checked.

:func:`assert_public_url` is the pre-flight variant, for a URL we hand to someone
else to fetch (the tiler) rather than fetching ourselves.
"""

import asyncio
import ipaddress
import socket
import time
from collections.abc import Sequence
from typing import Any
from urllib.parse import urlparse

import httpx

from src import perf

BAD_SCHEME = "URL must be http or https"
NO_HOST = "URL has no host"
UNRESOLVABLE = "URL host could not be resolved"
BLOCKED_HOST = "URL host is not permitted"


class UnsafeUrlError(ValueError):
    """A URL we refuse to fetch, or to have a downstream service fetch for us."""


# Ranges the ipaddress flags below do not cover.
# 100.64.0.0/10 is RFC 6598 carrier-grade NAT, which several cloud providers hand to
# internal services; Python does not count it as private. 2002::/16 is 6to4, whose
# address embeds an IPv4 one - 2002:7f00:1:: carries 127.0.0.1 - so the flags see a
# public v6 address while the packet can land somewhere internal.
_EXTRA_INTERNAL_NETS = (
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("2002::/16"),
)


def is_internal_ip(ip_str: str) -> bool:
    addr = ipaddress.ip_address(ip_str)
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
        or any(addr in net for net in _EXTRA_INTERNAL_NETS if net.version == addr.version)
    )


def _target(scheme: str | None, host: str | None, port: int | None) -> tuple[str, int]:
    """The (host, port) to resolve and check. Every URL has one; there is no opt-out."""
    if scheme not in ("http", "https"):
        raise UnsafeUrlError(BAD_SCHEME)
    if not host:
        raise UnsafeUrlError(NO_HOST)
    return host, port or (443 if scheme == "https" else 80)


def _pick_public_ip(addrinfos: Sequence[Any]) -> str:
    """The address to connect to. Any internal answer rejects the whole host, so a
    name that resolves to both a public and an internal address is never usable."""
    ips = [str(info[4][0]) for info in addrinfos]
    if not ips:
        raise UnsafeUrlError(UNRESOLVABLE)
    if any(is_internal_ip(ip) for ip in ips):
        raise UnsafeUrlError(BLOCKED_HOST)
    return ips[0]


# A tile pan is dozens of proxied requests to the same few provider hosts, so the
# validated address is remembered briefly rather than re-resolved per tile. Only
# addresses that passed the check are cached, and we pin to the cached one, so a
# hit is exactly as safe as the lookup that filled it. Rejections are never cached.
DNS_CACHE_TTL = 60.0
_DNS_CACHE_MAX = 512
_dns_cache: dict[tuple[str, int], tuple[float, str]] = {}


def _cached_ip(host: str, port: int) -> str | None:
    entry = _dns_cache.get((host, port))
    if entry is None or entry[0] < time.monotonic():
        return None
    return entry[1]


def _remember_ip(host: str, port: int, ip: str) -> None:
    if len(_dns_cache) >= _DNS_CACHE_MAX:
        _dns_cache.clear()
    _dns_cache[(host, port)] = (time.monotonic() + DNS_CACHE_TTL, ip)


def _checked_ip(host: str, port: int) -> str:
    ip = _cached_ip(host, port)
    if ip is None:
        try:
            addrinfos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
        except socket.gaierror as e:
            raise UnsafeUrlError(UNRESOLVABLE) from e
        ip = _pick_public_ip(addrinfos)
        _remember_ip(host, port, ip)
    return ip


async def _checked_ip_async(host: str, port: int) -> str:
    """As :func:`_checked_ip`, off the event loop - the tile proxy is async."""
    ip = _cached_ip(host, port)
    if ip is None:
        try:
            addrinfos = await asyncio.get_running_loop().getaddrinfo(
                host, port, proto=socket.IPPROTO_TCP
            )
        except socket.gaierror as e:
            raise UnsafeUrlError(UNRESOLVABLE) from e
        ip = _pick_public_ip(addrinfos)
        _remember_ip(host, port, ip)
    return ip


def _pin(request: httpx.Request, ip: str) -> None:
    """Connect to the validated address while keeping the Host header and the TLS
    hostname (SNI + certificate check) as they were."""
    request.extensions = {**request.extensions, "sni_hostname": request.url.host}
    request.url = request.url.copy_with(host=ip)


def assert_public_url(url: str) -> None:
    """Reject a URL that a downstream service must not be asked to fetch.

    Point-in-time only - it cannot pin what someone else connects to. Use a
    :func:`guarded_client` instead whenever we do the fetching.
    """
    parsed = urlparse(url)
    _checked_ip(*_target(parsed.scheme, parsed.hostname, parsed.port))


class GuardedTransport(httpx.HTTPTransport):
    def handle_request(self, request: httpx.Request) -> httpx.Response:
        started = time.perf_counter()
        try:
            target = _target(request.url.scheme, request.url.host, request.url.port)
            _pin(request, _checked_ip(*target))
            return super().handle_request(request)
        finally:
            perf.record_upstream((time.perf_counter() - started) * 1000)


class GuardedAsyncTransport(httpx.AsyncHTTPTransport):
    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        started = time.perf_counter()
        try:
            target = _target(request.url.scheme, request.url.host, request.url.port)
            _pin(request, await _checked_ip_async(*target))
            return await super().handle_async_request(request)
        finally:
            perf.record_upstream((time.perf_counter() - started) * 1000)


def guarded_client(*, limits: httpx.Limits | None = None, **kwargs: Any) -> httpx.Client:
    """An httpx client whose every request - redirects included - goes through the guard.

    ``limits`` belongs to the transport, so it can't be passed through ``kwargs``.
    """
    transport = GuardedTransport(limits=limits) if limits else GuardedTransport()
    return httpx.Client(transport=transport, **kwargs)


def guarded_async_client(*, limits: httpx.Limits | None = None, **kwargs: Any) -> httpx.AsyncClient:
    """As :func:`guarded_client`, async. ``limits`` belongs to the transport, so like the
    sync variant it cannot be passed through ``kwargs``."""
    transport = GuardedAsyncTransport(limits=limits) if limits else GuardedAsyncTransport()
    return httpx.AsyncClient(transport=transport, **kwargs)
