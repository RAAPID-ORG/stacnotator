from src.campaigns.schemas import CampaignOut, CampaignSummaryOut

# The whole point of the summary: these are what cost ~20 sequential queries to load.
IMAGERY_FIELDS = {
    "imagery_sources",
    "imagery_views",
    "basemaps",
    "custom_maps",
    "vector_layers",
    "time_series",
}


def test_the_summary_carries_no_imagery():
    """If one of these creeps back in, the endpoint silently costs what it was
    created to avoid."""
    assert IMAGERY_FIELDS.isdisjoint(CampaignSummaryOut.model_fields)


def test_the_summary_carries_what_the_pages_actually_read():
    needed = {
        "id",
        "project_id",
        "name",
        "created_at",
        "mode",
        "settings",
        "registration_status",
        "embedding_status",
        "registration_errors",
        "viewer_is_admin",
        "viewer_is_member",
        "viewer_is_authoritative_reviewer",
    }
    assert needed <= set(CampaignSummaryOut.model_fields)


def test_the_full_response_is_the_summary_plus_imagery():
    """Inheritance rather than two parallel lists, so the shapes cannot drift."""
    assert issubclass(CampaignOut, CampaignSummaryOut)
    added = set(CampaignOut.model_fields) - set(CampaignSummaryOut.model_fields)
    assert added == IMAGERY_FIELDS


def test_the_full_response_kept_every_field_it_had():
    """Splitting the model must not change what existing clients receive."""
    assert set(CampaignSummaryOut.model_fields) < set(CampaignOut.model_fields)
