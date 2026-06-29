from src.custommaps.models import CustomMap


def test_custom_map_table_and_defaults():
    assert CustomMap.__tablename__ == "custom_maps"
    assert CustomMap.__table__.schema == "data"
    cols = CustomMap.__table__.columns
    assert "campaign_id" in cols
    assert "render_config" in cols
    assert cols["status"].server_default.arg == "registering"
