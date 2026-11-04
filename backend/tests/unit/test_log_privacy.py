import logging

import pytest

from src.redact import install_log_redaction


@pytest.fixture
def redacting():
    previous = logging.getLogRecordFactory()
    install_log_redaction()
    yield
    logging.setLogRecordFactory(previous)


def test_access_log_drops_client_address_and_query(redacting, caplog):
    caplog.set_level(logging.INFO, logger="uvicorn.access")
    logging.getLogger("uvicorn.access").info(
        '%s - "%s %s HTTP/%s" %d',
        "203.0.113.7:51234",
        "GET",
        "/api/campaigns/1/tiles/5/10/12@2x.png?user=alice",
        "1.1",
        200,
    )
    assert caplog.messages == ['- - "GET /api/campaigns/1/tiles/5/10/12@2x.png HTTP/1.1" 200']


def test_emails_in_messages_and_tracebacks_are_masked(redacting, caplog):
    logger = logging.getLogger("test.log_privacy")
    try:
        raise ValueError("Key (email)=(alice@example.org) already exists")
    except ValueError:
        logger.exception("insert failed for %s", "bob@uni.example.fr")
    assert "alice@" not in caplog.text
    assert "bob@" not in caplog.text
    assert "insert failed for <email>" in caplog.text
