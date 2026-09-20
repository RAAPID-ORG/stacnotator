"""DB-free tests for the pure pieces of campaign duplication."""

from types import SimpleNamespace

from src.campaigns.duplication import clone_row, plan_copy, remapped_layout_data
from src.campaigns.models import TaskSet
from src.imagery.models import ImagerySlice


class TestRemappedLayoutData:
    def test_numeric_keys_follow_the_collection_map(self):
        layout = [
            {"i": "10", "x": 0, "y": 40, "w": 10, "h": 11},
            {"i": "20", "x": 10, "y": 40, "w": 10, "h": 11},
        ]
        result = remapped_layout_data(layout, {10: 110, 20: 220})
        assert [item["i"] for item in result] == ["110", "220"]
        assert result[0]["x"] == 0 and result[1]["x"] == 10

    def test_chrome_and_timeseries_keys_pass_through(self):
        layout = [
            {"i": "main", "x": 0, "y": 0, "w": 44, "h": 26},
            {"i": "timeseries:NDVI", "x": 0, "y": 26, "w": 44, "h": 14},
        ]
        assert remapped_layout_data(layout, {}) == layout

    def test_unmapped_collection_windows_are_dropped(self):
        layout = [{"i": "10", "x": 0, "y": 40, "w": 10, "h": 11}]
        assert remapped_layout_data(layout, {99: 199}) == []

    def test_input_items_are_not_mutated(self):
        layout = [{"i": "10", "x": 0, "y": 40, "w": 10, "h": 11}]
        remapped_layout_data(layout, {10: 110})
        assert layout[0]["i"] == "10"


class TestCloneRow:
    def test_copies_columns_and_applies_overrides(self):
        original = ImagerySlice(
            id=5,
            collection_id=7,
            name="Week 1",
            start_date="2024-01-01",
            end_date="2024-01-07",
            display_order=3,
        )
        copy = clone_row(original, collection_id=70)
        assert copy.id is None
        assert copy.collection_id == 70
        assert (copy.name, copy.start_date, copy.end_date, copy.display_order) == (
            "Week 1",
            "2024-01-01",
            "2024-01-07",
            3,
        )

    def test_primary_key_never_carries_over(self):
        original = TaskSet(id=9, campaign_id=1, name="Round 1")
        copy = clone_row(original, campaign_id=2)
        assert copy.id is None
        assert copy.campaign_id == 2
        assert copy.name == "Round 1"


class TestPlanCopy:
    def _campaign(self, project_id=1, organization_id=7):
        return SimpleNamespace(
            name="Sahel 2024",
            project_id=project_id,
            project=SimpleNamespace(id=project_id, organization_id=organization_id),
        )

    def _plan(self, target, **flags):
        return plan_copy(
            self._campaign(),
            target,
            **{
                "include_tasks": True,
                "include_annotations": True,
                "include_user_layouts": True,
                **flags,
            },
        )

    def test_same_project_copies_everything_asked_for(self):
        plan = self._plan(None)

        assert (plan.project_id, plan.name) == (1, "Sahel 2024 (copy)")
        assert (plan.tasks, plan.annotations, plan.assignments, plan.user_layouts) == (
            True,
            True,
            True,
            True,
        )
        assert plan.shared_api_keys is True

    def test_assignments_can_be_left_behind_while_the_tasks_come_along(self):
        plan = self._plan(None, include_assignments=False)

        assert (plan.tasks, plan.assignments, plan.agent_assignments) == (True, False, False)

    def test_assignments_need_the_tasks_they_sit_on(self):
        plan = self._plan(None, include_tasks=False)

        assert (plan.assignments, plan.agent_assignments) == (False, False)

    def test_what_labelling_agents_hold_is_dropped_unless_asked_for(self):
        assert self._plan(None).agent_assignments is False
        assert self._plan(None, include_agent_assignments=True).agent_assignments is True

    def test_the_campaigns_own_project_as_target_is_a_plain_duplicate(self):
        plan = self._plan(SimpleNamespace(id=1, organization_id=7))

        assert (plan.project_id, plan.name) == (1, "Sahel 2024 (copy)")
        assert (plan.annotations, plan.assignments, plan.user_layouts) == (True, True, True)

    def test_another_project_drops_everything_naming_a_user(self):
        plan = self._plan(SimpleNamespace(id=2, organization_id=7))

        assert plan.project_id == 2
        assert (plan.annotations, plan.assignments, plan.user_layouts) == (False, False, False)
        assert plan.agent_assignments is False

    def test_another_project_keeps_the_name_and_the_tasks(self):
        plan = self._plan(SimpleNamespace(id=2, organization_id=7), include_tasks=True)

        assert (plan.name, plan.tasks) == ("Sahel 2024", True)

    def test_tasks_stay_optional_across_projects(self):
        plan = self._plan(SimpleNamespace(id=2, organization_id=7), include_tasks=False)

        assert plan.tasks is False

    def test_same_organization_keeps_the_shared_api_keys(self):
        assert self._plan(SimpleNamespace(id=2, organization_id=7)).shared_api_keys is True

    def test_another_organization_drops_the_shared_api_keys(self):
        assert self._plan(SimpleNamespace(id=2, organization_id=8)).shared_api_keys is False
