"""The SSRF guard: what it refuses, and that it pins what it allowed."""

import socket

import httpx
import pytest
from fastapi import HTTPException

from src import net_guard
from src.stac_browser import catalogs
from src.tilers import registry

PUBLIC_IP = "93.184.216.34"


@pytest.fixture(autouse=True)
def _no_cached_resolutions():
    """The guard remembers validated addresses; each test resolves for itself."""
    net_guard._dns_cache.clear()
    yield
    net_guard._dns_cache.clear()


def _resolves(monkeypatch, answers: dict[str, list[str]] | None = None):
    """Point DNS at fixed answers, keyed on hostname. Anything unlisted resolves
    to ``PUBLIC_IP``."""
    answers = answers or {}

    def _resolve(host, port, proto=socket.IPPROTO_TCP):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (ip, port))
            for ip in answers.get(host, [PUBLIC_IP])
        ]

    monkeypatch.setattr(net_guard.socket, "getaddrinfo", _resolve)


def _capture_transport(monkeypatch, *responses: httpx.Response) -> list[httpx.Request]:
    """Swap the real network out from under the guard, keeping every request it let through."""
    seen: list[httpx.Request] = []
    queue = list(responses)

    def _handle(self, request):
        seen.append(request)
        return queue.pop(0) if queue else httpx.Response(200)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", _handle)
    return seen


def test_allows_a_public_host(monkeypatch):
    _resolves(monkeypatch)
    net_guard.assert_public_url("https://example.com/stac")


def test_a_configured_origin_is_checked_like_any_other(monkeypatch):
    """Appearing in our own config buys a URL nothing here. It cannot: by the time a
    URL reaches the guard it is a string, and a string cannot say who chose it."""
    lookups = []

    def _resolve(host, port, proto=socket.IPPROTO_TCP):
        lookups.append(host)
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (PUBLIC_IP, port))]

    monkeypatch.setattr(net_guard.socket, "getaddrinfo", _resolve)
    net_guard.assert_public_url(registry.MPC_STAC_URL)
    assert lookups == ["planetarycomputer.microsoft.com"]


def test_a_configured_origin_resolving_internally_is_rejected(monkeypatch):
    """The case that mattered: a user naming our own tiler as their catalog."""
    _resolves(monkeypatch, {"tiler.internal": ["10.0.0.7"]})
    with pytest.raises(net_guard.UnsafeUrlError) as exc_info:
        net_guard.assert_public_url("http://tiler.internal:8000/searches/list")
    assert str(exc_info.value) == net_guard.BLOCKED_HOST


@pytest.mark.parametrize(
    "url", ["ftp://example.com/stac", "file:///etc/passwd", "gopher://example.com/"]
)
def test_rejects_non_http_schemes(url):
    with pytest.raises(net_guard.UnsafeUrlError):
        net_guard.assert_public_url(url)


def test_rejects_a_missing_host():
    with pytest.raises(net_guard.UnsafeUrlError):
        net_guard.assert_public_url("http:///stac")


def test_rejects_an_unresolvable_host(monkeypatch):
    def _raise(*args, **kwargs):
        raise socket.gaierror("name or service not known")

    monkeypatch.setattr(net_guard.socket, "getaddrinfo", _raise)
    with pytest.raises(net_guard.UnsafeUrlError):
        net_guard.assert_public_url("https://nonexistent.example.com/stac")


@pytest.mark.parametrize(
    "ip", ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1"]
)
def test_rejects_internal_addresses(monkeypatch, ip):
    _resolves(monkeypatch, {"internal.example.com": [ip]})
    with pytest.raises(net_guard.UnsafeUrlError):
        net_guard.assert_public_url("https://internal.example.com/stac")


def test_one_internal_answer_rejects_the_whole_host(monkeypatch):
    """Otherwise a name answering with both addresses is a coin flip at connect time."""
    _resolves(monkeypatch, {"rebind.example.com": [PUBLIC_IP, "127.0.0.1"]})
    with pytest.raises(net_guard.UnsafeUrlError):
        net_guard.assert_public_url("https://rebind.example.com/stac")


def test_pins_the_connection_but_keeps_the_tls_hostname(monkeypatch):
    """The socket goes to the address we checked, while SNI, the certificate check
    and the Host header still say what the user asked for - so a second DNS answer
    between check and connect buys nothing."""
    _resolves(monkeypatch)
    seen = _capture_transport(monkeypatch)

    with net_guard.guarded_client() as client:
        client.get("https://example.com/tiles/1/2/3")

    (request,) = seen
    assert request.url.host == PUBLIC_IP
    assert request.headers["Host"] == "example.com"
    assert request.extensions["sni_hostname"] == "example.com"


def test_guards_every_redirect_hop(monkeypatch):
    """Checking the entry URL is worthless if a 302 can move the fetch anywhere."""
    _resolves(monkeypatch, {"internal.example.com": ["127.0.0.1"]})
    _capture_transport(
        monkeypatch,
        httpx.Response(302, headers={"Location": "https://internal.example.com/secret"}),
    )

    with (
        net_guard.guarded_client(follow_redirects=True) as client,
        pytest.raises(net_guard.UnsafeUrlError),
    ):
        client.get("https://example.com/start")


def test_a_rejected_host_is_never_cached(monkeypatch):
    """Only validated addresses are remembered - a refusal has to be re-derived,
    or a host that briefly resolved internally would stay blocked for a minute."""
    lookups = []

    def _resolve(host, port, proto=socket.IPPROTO_TCP):
        lookups.append(host)
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("127.0.0.1", port))]

    monkeypatch.setattr(net_guard.socket, "getaddrinfo", _resolve)
    for _ in range(2):
        with pytest.raises(net_guard.UnsafeUrlError):
            net_guard.assert_public_url("https://internal.example.com/stac")
    assert len(lookups) == 2


def test_a_validated_host_is_resolved_once_per_ttl(monkeypatch):
    """A tile pan is dozens of requests to the same host; one lookup covers them."""
    lookups = []

    def _resolve(host, port, proto=socket.IPPROTO_TCP):
        lookups.append(host)
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (PUBLIC_IP, port))]

    monkeypatch.setattr(net_guard.socket, "getaddrinfo", _resolve)
    for _ in range(3):
        net_guard.assert_public_url("https://tiles.example.com/1/2/3")
    assert len(lookups) == 1


def test_catalog_url_error_surfaces_as_a_400(monkeypatch):
    _resolves(monkeypatch, {"internal.example.com": ["127.0.0.1"]})
    with pytest.raises(HTTPException) as exc_info:
        catalogs.assert_catalog_url_safe("https://internal.example.com/stac")
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == net_guard.BLOCKED_HOST


@pytest.mark.parametrize(
    "ip",
    [
        "100.64.0.1",  # RFC 6598 CGNAT - clouds hand this to internal services
        "100.127.255.254",
        "2002:7f00:1::",  # 6to4 carrying 127.0.0.1
        "2002:a00:1::",  # 6to4 carrying 10.0.0.1
    ],
)
def test_ranges_the_ipaddress_flags_do_not_cover_are_internal(ip):
    assert net_guard.is_internal_ip(ip) is True


@pytest.mark.parametrize("ip", ["8.8.8.8", "2001:4860:4860::8888", "100.128.0.1"])
def test_public_addresses_stay_public(ip):
    """100.128.0.1 sits just past the CGNAT block - the added range must not overreach."""
    assert net_guard.is_internal_ip(ip) is False
