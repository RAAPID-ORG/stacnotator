import logging
import re
import unicodedata
from datetime import datetime

import ee
from fastapi.routing import APIRoute

from src.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


# ============================================================================
# String Utilities
# ============================================================================


def clean_filename(value: str, max_length: int = 64) -> str:
    """
    Sanitize a string to be safe for use as a filename.

    Converts to ASCII, replaces invalid characters with underscores,
    and truncates to maximum length.

    Args:
        value: String to sanitize
        max_length: Maximum length of the result (default 64)

    Returns:
        Sanitized filename string
    """
    if not value:
        return value

    # Normalize unicode to ASCII
    value = unicodedata.normalize("NFKD", value)
    value = value.encode("ascii", "ignore").decode("ascii")

    # Lowercase, replace spaces & invalid chars with underscore
    value = re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()

    return value[:max_length]


def snake_to_camel(name: str) -> str:
    """
    Convert snake_case string to camelCase.

    Args:
        name: Snake case string

    Returns:
        Camel case string

    Example:
        >>> snake_to_camel("get_campaign_list")
        "getCampaignList"
    """
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


# ============================================================================
# Date/Time Utilities
# ============================================================================


def parse_ym_to_date(ym_str: str) -> datetime:
    """
    Convert YYYYMM string to datetime (first day of month).

    Args:
        ym_str: Date string in YYYYMM format

    Returns:
        Datetime object for the first day of the specified month

    Example:
        >>> parse_ym_to_date("202501")
        datetime(2025, 1, 1)
    """
    year = int(ym_str[:4])
    month = int(ym_str[4:6])
    return datetime(year, month, 1)


def format_date_to_yyyymmdd(date: datetime) -> str:
    """
    Convert datetime to YYYYMMDD string.

    Args:
        date: Datetime object to format

    Returns:
        Date string in YYYYMMDD format

    Example:
        >>> format_date_to_yyyymmdd(datetime(2025, 1, 15))
        "20250115"
    """
    return date.strftime("%Y%m%d")


# ============================================================================
# Canvas Layout Utilities
# ============================================================================


def find_free_position_in_layout(
    layout_data: list[dict],
    item_width: int,
    item_height: int,
    grid_width: int = 60,
) -> tuple[int, int]:
    """
    Find the next available position in a canvas layout using 2D bin packing.

    Scans the layout from top to bottom, left to right, to find the first
    position where an item of the specified dimensions will fit without
    overlapping existing items.

    Args:
        layout_data: List of layout items, each with 'x', 'y', 'w', 'h' keys
        item_width: Width of the item to place
        item_height: Height of the item to place
        grid_width: Total grid width available (default 60)

    Returns:
        Tuple of (x, y) coordinates for the item

    Note:
        Canvas is scrollable vertically, so there's no height limit.
    """
    # Track occupied spaces
    occupied_spaces = [
        {
            "x": item.get("x", 0),
            "y": item.get("y", 0),
            "w": item.get("w", 0),
            "h": item.get("h", 0),
        }
        for item in layout_data
    ]

    def is_position_free(x: int, y: int) -> bool:
        """Check if a position with item dimensions is free."""
        for space in occupied_spaces:
            # Check if rectangles overlap
            if not (
                x + item_width <= space["x"]  # Completely to the left
                or x >= space["x"] + space["w"]  # Completely to the right
                or y + item_height <= space["y"]  # Completely above
                or y >= space["y"] + space["h"]  # Completely below
            ):
                return False
        return True

    # Start from the top of the canvas
    current_y = 0

    while True:
        # Try to place in current row
        for x in range(0, grid_width - item_width + 1):
            if is_position_free(x, current_y):
                return (x, current_y)

        # Move to next row
        current_y += 1


# ============================================================================
# FastAPI Route Utilities
# ============================================================================


def generate_unique_id(route: APIRoute) -> str:
    """
    Generate OpenAPI operation ID from route function name.

    Converts the endpoint function name from snake_case to camelCase
    for use as the OpenAPI operation ID.

    Args:
        route: FastAPI route object

    Returns:
        CamelCase operation ID
    """
    return snake_to_camel(route.endpoint.__name__)


class FunctionNameOperationIdRoute(APIRoute):
    """
    Custom APIRoute that automatically sets operation_id from function name.

    Use this as the route_class in APIRouter to automatically generate
    operation IDs from endpoint function names. Used for better readability
    in aut-generating client SDKs from OpenAPI specs.

    Example:
        router = APIRouter(route_class=FunctionNameOperationIdRoute)
    """

    def __init__(self, *args, **kwargs):
        if "operation_id" not in kwargs:
            endpoint = kwargs.get("endpoint")
            if endpoint:
                kwargs["operation_id"] = snake_to_camel(endpoint.__name__)
        super().__init__(*args, **kwargs)


# ============================================================================
# Earth Engine Utils
# ============================================================================


def initialize_earth_engine() -> bool:
    """
    Initialize EarthEngine using a service account.

    Returns True if initialized, False if EE is unconfigured or init failed.
    Enables usage without EE creeedentials- only EE-dependent endpoints
    (timeseries, embeddings) will fail at call time with a clearer error
    than a startup crash.
    """
    service_account = settings.EE_SERVICE_ACCOUNT
    private_key_path = settings.EE_PRIVATE_KEY_PATH
    private_key = settings.EE_PRIVATE_KEY

    if not service_account or (not private_key_path and not private_key):
        logger.warning(
            "Earth Engine not configured (EE_SERVICE_ACCOUNT and "
            "EE_PRIVATE_KEY[_PATH] required); EE-dependent features disabled"
        )
        return False

    try:
        if private_key:
            credentials = ee.ServiceAccountCredentials(service_account, key_data=private_key)
        else:
            credentials = ee.ServiceAccountCredentials(service_account, private_key_path)
        ee.Initialize(credentials)
        return True
    except Exception as exc:
        logger.warning(
            "Earth Engine initialization failed (%s); EE-dependent features disabled", exc
        )
        return False
