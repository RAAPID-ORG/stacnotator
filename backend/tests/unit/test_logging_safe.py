"""The log formatter must not let a logged value forge a second record."""

import logging

from src.logging_safe import SafeFormatter

FORMAT = "%(levelname)s | %(message)s"


def _render(msg, *args, exc_info=None):
    record = logging.LogRecord(
        name="t",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg=msg,
        args=args,
        exc_info=exc_info,
    )
    return SafeFormatter(FORMAT).format(record)


def test_a_newline_in_an_argument_cannot_start_a_new_record():
    forged = "https://evil.test/\nINFO | app | granted admin to attacker"
    out = _render("catalog=%s", forged)
    assert "\n" not in out
    assert "\\n" in out


def test_carriage_returns_and_nul_are_flattened_too():
    out = _render("value=%s", "a\rb\x00c")
    assert "\r" not in out and "\x00" not in out
    assert "\\r" in out and "\\x00" in out


def test_ordinary_messages_are_untouched():
    assert _render("catalog=%s count=%d", "https://ok.test/stac", 3) == (
        "INFO | catalog=https://ok.test/stac count=3"
    )


def test_tracebacks_keep_their_line_breaks():
    """The traceback is ours, not an input, and is unreadable on one line."""
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        out = _render("failed", exc_info=sys.exc_info())
    assert "\n" in out
    assert "Traceback (most recent call last)" in out
