"""Shared fixtures for unit tests. No database or external services needed."""

import os
from uuid import uuid4

import pytest

# Some modules (src.utils) call get_settings() at import time,
# so we need DB env vars present before any src imports happen.
os.environ.setdefault("DBNAME", "testdb")
os.environ.setdefault("DBUSER", "testuser")
os.environ.setdefault("DBPASS", "testpass")
os.environ.setdefault("DBHOST", "localhost")
os.environ.setdefault("DBPORT", "5432")

# Ensure all ORM models are registered so SQLAlchemy relationship resolution works
import src.models  # noqa: F401, E402


@pytest.fixture()
def sample_user_id():
    return uuid4()


@pytest.fixture()
def sample_labels():
    return [
        {"id": 1, "name": "Forest", "geometry_type": "polygon"},
        {"id": 2, "name": "Water", "geometry_type": "polygon"},
        {"id": 3, "name": "Building", "geometry_type": "point"},
    ]


@pytest.fixture()
def sample_settings_data(sample_labels):
    return {
        "labels": sample_labels,
        "bbox_west": -10.0,
        "bbox_south": 35.0,
        "bbox_east": 10.0,
        "bbox_north": 55.0,
    }
