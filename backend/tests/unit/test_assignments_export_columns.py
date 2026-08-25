from src.campaigns.assignments import _IMPORT_REQUIRED_COLUMNS, ASSIGNMENTS_CSV_COLUMNS


def test_the_export_says_which_set_each_task_belongs_to():
    """Without it a whole-campaign export is unreadable once a campaign has more than
    one task set - every row looks alike and nothing says which set it came from."""
    assert "task_set" in ASSIGNMENTS_CSV_COLUMNS


def test_the_new_column_does_not_become_a_required_import_column():
    """Import matches on annotation_number, which is unique campaign-wide. Requiring
    task_set would break every CSV an admin already has."""
    assert "task_set" not in _IMPORT_REQUIRED_COLUMNS
    assert set(ASSIGNMENTS_CSV_COLUMNS) >= _IMPORT_REQUIRED_COLUMNS
