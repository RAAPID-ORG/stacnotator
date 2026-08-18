import importlib.util
from pathlib import Path
from unittest.mock import Mock


def _migration():
    path = (
        Path(__file__).parents[2]
        / "alembic"
        / "versions"
        / "ac1imggen_add_imagery_generation_metadata.py"
    )
    spec = importlib.util.spec_from_file_location("imagery_generation_migration", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_upgrade_creates_series_table_and_collection_reference(monkeypatch):
    migration = _migration()
    operations = Mock()
    monkeypatch.setattr(migration, "op", operations)

    migration.upgrade()

    assert operations.create_table.call_args.args[0] == "imagery_generation_series"
    operations.add_column.assert_called_once()
    operations.create_foreign_key.assert_called_once_with(
        "imagery_collections_generation_series_id_fkey",
        "imagery_collections",
        "imagery_generation_series",
        ["generation_series_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="SET NULL",
    )


def test_migration_does_not_infer_historical_generator_provenance():
    migration = _migration()

    assert not hasattr(migration, "_backfill_generation_metadata")


def test_downgrade_removes_collection_reference_before_series_table(monkeypatch):
    migration = _migration()
    operations = Mock()
    monkeypatch.setattr(migration, "op", operations)

    migration.downgrade()

    operations.drop_constraint.assert_called_once()
    operations.drop_column.assert_called_once_with(
        "imagery_collections", "generation_series_id", schema="data"
    )
    operations.drop_table.assert_called_once_with("imagery_generation_series", schema="data")
