import re
import unicodedata


def clean_filename(value: str, max_length: int = 64) -> str:
    """Sanitize a string for use as a download filename.

    Normalizes unicode to ASCII, replaces runs of invalid characters with a
    single underscore, lowercases, and truncates to ``max_length``.
    """
    if not value:
        return value

    value = unicodedata.normalize("NFKD", value)
    value = value.encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()

    return value[:max_length]
