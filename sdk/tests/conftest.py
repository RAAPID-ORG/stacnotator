import pytest


@pytest.fixture(autouse=True)
def isolated_config_dir(tmp_path, monkeypatch):
    """Every test gets its own credentials directory so no test touches ~/.config."""
    config_dir = tmp_path / "stacnotator-config"
    monkeypatch.setenv("STACNOTATOR_CONFIG_DIR", str(config_dir))
    return config_dir
