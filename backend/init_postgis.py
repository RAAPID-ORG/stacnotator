#!/usr/bin/env python3
"""
Run init-db.sql to initialize PostGIS extensions.
We use this for azure setups where we dont have psql command line tool.
"""

import sys
from pathlib import Path
from sqlalchemy import create_engine, text
from src.config import get_settings


def run_init_db_sql():
    """Execute init-db.sql to create PostGIS extensions."""
    settings = get_settings()

    # Read init-db.sql
    init_sql_path = Path(__file__).parent / "init-db.sql"
    if not init_sql_path.exists():
        print(f"ERROR: {init_sql_path} not found", file=sys.stderr)
        return 1

    print(f"Reading {init_sql_path}...")
    sql_content = init_sql_path.read_text()

    print("Connecting to database...")
    engine = create_engine(settings.DATABASE_URL)

    print("Executing init-db.sql...")
    with engine.begin() as conn:  # Use begin() for automatic transaction management
        # Split by semicolons and execute each statement
        statements = [
            s.strip()
            for s in sql_content.split(";")
            if s.strip() and not s.strip().startswith("--")
        ]

        for stmt in statements:
            if stmt:
                print(f"  Executing: {stmt[:50]}...")
                conn.execute(text(stmt))
        # Transaction is automatically committed when exiting the with block

    print("✓ Database initialization complete!")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(run_init_db_sql())
    except Exception as e:
        print(f"ERROR: Failed to initialize database: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc()
        sys.exit(1)
