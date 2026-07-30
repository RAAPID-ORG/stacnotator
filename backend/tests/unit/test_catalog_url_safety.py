import socket

import pytest
from fastapi import HTTPException

from src.stac_browser import catalogs
from src.tilers import registry


def _fake_getaddrinfo(ip: str):
    def _resolve(host, port, proto=socket.IPPROTO_TCP):
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (ip, port))]

    return _resolve


def test_allows_public_ip(monkeypatch):
    monkeypatch.setattr(catalogs.socket, "getaddrinfo", _fake_getaddrinfo("93.184.216.34"))
    catalogs.assert_catalog_url_safe("https://example.com/stac")


def test_allows_trusted_origin_without_dns_lookup(monkeypatch):
    def _fail(*args, **kwargs):
        raise AssertionError("trusted origins must not trigger a DNS lookup")

    monkeypatch.setattr(catalogs.socket, "getaddrinfo", _fail)
    catalogs.assert_catalog_url_safe(registry.MPC_STAC_URL)


def test_rejects_non_http_scheme():
    with pytest.raises(HTTPException) as exc_info:
        catalogs.assert_catalog_url_safe("ftp://example.com/stac")
    assert exc_info.value.status_code == 400


def test_rejects_missing_host():
    with pytest.raises(HTTPException) as exc_info:
        catalogs.assert_catalog_url_safe("http:///stac")
    assert exc_info.value.status_code == 400


def test_rejects_unresolvable_host(monkeypatch):
    def _raise(host, port, proto=socket.IPPROTO_TCP):
        raise socket.gaierror("name or service not known")

    monkeypatch.setattr(catalogs.socket, "getaddrinfo", _raise)
    with pytest.raises(HTTPException) as exc_info:
        catalogs.assert_catalog_url_safe("https://nonexistent.example.com/stac")
    assert exc_info.value.status_code == 400


def test_rejects_internal_ip(monkeypatch):
    monkeypatch.setattr(catalogs.socket, "getaddrinfo", _fake_getaddrinfo("127.0.0.1"))
    with pytest.raises(HTTPException) as exc_info:
        catalogs.assert_catalog_url_safe("https://internal.example.com/stac")
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == catalogs._INTERNAL_IP_ERROR
