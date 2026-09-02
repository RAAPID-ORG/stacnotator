"""What an organization key's tile host accepts, and what it insists on.

The host is what keeps a shared secret out of reach of the campaign admins who
write the tile URLs it is used with, so the boundary is where it is enforced.
"""

import pytest
from pydantic import ValidationError

from src.organizations.schemas import OrganizationApiKeyCreate, OrganizationApiKeyUpdate


def _create(host: str) -> OrganizationApiKeyCreate:
    return OrganizationApiKeyCreate(name="Planet", value="secret", allowed_tile_host=host)


@pytest.mark.parametrize(
    ("typed", "stored"),
    [
        ("tiles.planet.com", "tiles.planet.com"),
        ("https://tiles.planet.com/basemaps/v1/", "tiles.planet.com"),
        ("  TILES.planet.com ", "tiles.planet.com"),
    ],
)
def test_a_host_is_stored_the_same_however_it_was_written(typed, stored):
    assert _create(typed).allowed_tile_host == stored


@pytest.mark.parametrize("typed", ["", "   ", "localhost", "PLAKuFhY7pasted-key-here"])
def test_something_that_is_not_a_host_is_refused(typed):
    """Notably a key pasted into the host box: binding to that would leave the key
    stored, apparently fine, and silently unable to serve a tile."""
    with pytest.raises(ValidationError):
        _create(typed)


def test_a_new_key_cannot_be_created_without_one():
    with pytest.raises(ValidationError):
        OrganizationApiKeyCreate(name="Planet", value="secret")


def test_rotation_may_leave_the_host_alone():
    """Replacing the secret is the common case and says nothing about the host."""
    assert OrganizationApiKeyUpdate(value="new-secret").allowed_tile_host is None


def test_rotation_is_how_an_older_key_gets_its_host():
    rotated = OrganizationApiKeyUpdate(value="new-secret", allowed_tile_host="tiles.planet.com")

    assert rotated.allowed_tile_host == "tiles.planet.com"
