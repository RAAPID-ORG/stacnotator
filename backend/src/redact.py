"""Keep URL query strings - where SAS tokens and other signatures live - out of logs.

A private catalog is read with a SAS token appended to each request, and httpx/pystac
errors quote the URL they failed on. Installed once at startup as the log-record factory,
so every logger, third-party ones included, gets it: the message and any traceback are
redacted before a handler formats them.
"""

import logging
import re

_URL_QUERY = re.compile(r"(https?://[^\s'\"?#]+)\?[^\s'\"#]*")


def redact_urls(text: str) -> str:
    return _URL_QUERY.sub(r"\1?<redacted>", text)


def install_log_redaction() -> None:
    make_record = logging.getLogRecordFactory()
    formatter = logging.Formatter()

    def factory(*args, **kwargs) -> logging.LogRecord:
        record = make_record(*args, **kwargs)
        message = record.getMessage()
        redacted = redact_urls(message)
        if redacted != message:
            record.msg, record.args = redacted, None
        if record.exc_info:
            record.exc_text = redact_urls(formatter.formatException(record.exc_info))
        return record

    logging.setLogRecordFactory(factory)
