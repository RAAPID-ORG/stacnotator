"""DB-free structural tests for the tenancy models (organizations, projects).

These pin the parts other code relies on: schema placement, composite PKs,
status constants, and the campaign->project link."""

from src.campaigns.models import Campaign
from src.organizations.models import (
    ORG_STATUS_APPROVED,
    ORG_STATUS_PENDING,
    ORG_STATUS_REJECTED,
    Organization,
    OrganizationTiler,
    OrganizationUser,
)
from src.projects.models import Project, ProjectUser


def test_status_constants():
    assert (ORG_STATUS_PENDING, ORG_STATUS_APPROVED, ORG_STATUS_REJECTED) == (
        "pending",
        "approved",
        "rejected",
    )


def test_tables_live_in_data_schema():
    for model in (Organization, OrganizationUser, OrganizationTiler, Project, ProjectUser):
        assert model.__table__.schema == "data"


def test_membership_composite_pks():
    assert {c.name for c in OrganizationUser.__table__.primary_key} == {
        "user_id",
        "organization_id",
    }
    assert {c.name for c in ProjectUser.__table__.primary_key} == {"user_id", "project_id"}
    assert {c.name for c in OrganizationTiler.__table__.primary_key} == {
        "organization_id",
        "tiler_name",
    }


def test_project_user_carries_both_roles():
    cols = ProjectUser.__table__.columns
    assert "is_admin" in cols and "is_authoritative_reviewer" in cols


def test_campaign_links_to_project():
    col = Campaign.__table__.columns["project_id"]
    assert not col.nullable
    fk = next(iter(col.foreign_keys))
    assert fk.target_fullname == "data.projects.id"


def test_org_membership_defaults_active_non_admin():
    cols = OrganizationUser.__table__.columns
    assert cols["status"].server_default.arg == "active"
    assert not cols["is_admin"].nullable
