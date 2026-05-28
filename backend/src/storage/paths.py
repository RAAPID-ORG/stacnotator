import os


def custom_map_source_path(
    campaign_id: int, custom_map_id: str, filename: str = "source.tif"
) -> str:
    safe = os.path.basename(filename) or "source.tif"
    return f"campaigns/{campaign_id}/custom-maps/{custom_map_id}/{safe}"


def custom_map_cog_path(campaign_id: int, custom_map_id: str) -> str:
    return f"campaigns/{campaign_id}/custom-maps/{custom_map_id}/cog.tif"


def custom_map_prefix(campaign_id: int, custom_map_id: str) -> str:
    return f"campaigns/{campaign_id}/custom-maps/{custom_map_id}/"
