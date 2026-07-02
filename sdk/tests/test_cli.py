import responses

from stacnotator._credentials import Credentials, load, save
from stacnotator.cli import main

BASE = "https://app.example.org"


def save_local_creds():
    save(Credentials(url=BASE, auth={"mode": "none"}))


@responses.activate
def test_login_saves_credentials_and_greets(capsys):
    responses.get(f"{BASE}/api/auth/me", json={"email": "local@localhost"})
    responses.get(f"{BASE}/api/auth/me", json={"email": "local@localhost"})

    assert main(["login", BASE]) == 0

    assert load() == Credentials(url=BASE, auth={"mode": "none"})
    assert "local@localhost" in capsys.readouterr().out


@responses.activate
def test_whoami_prints_user(capsys):
    save_local_creds()
    responses.get(f"{BASE}/api/auth/me", json={"email": "a@b.c", "display_name": "Ada"})

    assert main(["whoami"]) == 0
    assert "a@b.c" in capsys.readouterr().out


def test_whoami_without_login_fails_with_message(capsys):
    assert main(["whoami"]) == 1
    assert "Not logged in" in capsys.readouterr().err


@responses.activate
def test_campaigns_prints_table(capsys):
    save_local_creds()
    responses.get(
        f"{BASE}/api/campaigns/",
        json={
            "items": [
                {
                    "id": 42,
                    "name": "Crop mapping",
                    "created_at": "2026-06-01T10:00:00Z",
                    "is_admin": True,
                    "is_member": True,
                    "is_public": False,
                }
            ]
        },
    )

    assert main(["campaigns"]) == 0
    out = capsys.readouterr().out
    assert "Crop mapping" in out
    assert "42" in out


def test_logout_clears_credentials(capsys):
    save_local_creds()

    assert main(["logout"]) == 0
    assert load() is None


@responses.activate
def test_api_error_reported_on_stderr(capsys):
    save_local_creds()
    responses.get(f"{BASE}/api/auth/me", json={"detail": "Account not approved"}, status=403)

    assert main(["whoami"]) == 1
    assert "Account not approved" in capsys.readouterr().err
