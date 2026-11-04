"""Keep secrets and personal data out of logs.

URL query strings - where SAS tokens and other signatures live: a private catalog is
read with a SAS token appended to each request, and httpx/pystac errors quote the URL
they failed on. Email addresses, which database errors and tracebacks can quote. And
the access log's client address and query string, so a request line names no one.

Installed once at startup as the log-record factory, so every logger, third-party ones
included, gets it: the message and any traceback are redacted before a handler formats
them.
"""

import logging
import re

_URL_QUERY = re.compile(r"(https?://[^\s'\"?#]+)\?[^\s'\"#]*")
# The domain must start with a letter, so a retina tile path like 12@2x.png is left alone.
_EMAIL = re.compile(r"[\w.+-]+@[A-Za-z][\w-]*(\.[\w-]+)+")


def redact_urls(text: str) -> str:
    return _URL_QUERY.sub(r"\1?<redacted>", text)


def redact(text: str) -> str:
    return _EMAIL.sub("<email>", redact_urls(text))


def _anonymize_access_record(record: logging.LogRecord) -> None:
    # uvicorn.access logs (client_addr, method, full_path, http_version, status_code).
    if isinstance(record.args, tuple) and len(record.args) == 5:
        _client, method, full_path, http_version, status = record.args
        path = str(full_path).split("?", 1)[0]
        record.args = ("-", method, path, http_version, status)


def install_log_redaction() -> None:
    make_record = logging.getLogRecordFactory()
    formatter = logging.Formatter()

    def factory(*args, **kwargs) -> logging.LogRecord:
        record = make_record(*args, **kwargs)
        if record.name == "uvicorn.access":
            _anonymize_access_record(record)
        message = record.getMessage()
        redacted = redact(message)
        if redacted != message:
            record.msg, record.args = redacted, None
        if record.exc_info:
            record.exc_text = redact(formatter.formatException(record.exc_info))
        return record

    logging.setLogRecordFactory(factory)
