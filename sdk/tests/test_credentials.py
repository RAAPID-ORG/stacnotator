import stat

from stacnotator._credentials import Credentials, clear, credentials_path, load, save


def firebase_creds() -> Credentials:
    return Credentials(
        url="https://app.example.org",
        auth={"mode": "firebase", "api_key": "AIzaKey", "refresh_token": "r-token"},
    )


def test_load_returns_none_when_no_file():
    assert load() is None


def test_save_then_load_round_trips():
    save(firebase_creds())
    loaded = load()
    assert loaded == firebase_creds()


def test_credentials_file_is_private():
    save(firebase_creds())
    mode = credentials_path().stat().st_mode
    assert stat.S_IMODE(mode) == 0o600


def test_clear_removes_credentials():
    save(firebase_creds())
    clear()
    assert load() is None


def test_path_honors_config_dir_env(isolated_config_dir):
    assert credentials_path().parent == isolated_config_dir
