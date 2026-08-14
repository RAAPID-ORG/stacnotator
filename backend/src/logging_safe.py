"""A log formatter that cannot be made to emit more lines than it was asked for.

Logs are one record per line and are read that way. Any value that reaches a log
call can carry a newline - catalog URLs, collection ids, filenames, error text
from an upstream - and a newline in the middle of a record lets whoever supplied
it write a second record of their choosing.

Escaping at each call site only holds until someone adds a call site, so the
escape lives here instead: the formatted message is flattened, and the traceback
is left alone because it is genuinely multi-line and is ours, not an input.
"""

import logging

_ESCAPES = str.maketrans({"\n": "\\n", "\r": "\\r", "\x00": "\\x00"})


class SafeFormatter(logging.Formatter):
    """Formatter that flattens control characters in the message body."""

    def formatMessage(self, record: logging.LogRecord) -> str:
        formatted = super().formatMessage(record)
        return formatted.translate(_ESCAPES)
