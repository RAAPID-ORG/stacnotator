"""Repair custom-map rows whose render_config cannot render.

Renderability (build_viz_params) moves onto the RenderConfig schema, so rows
written before the service-level check must conform. Continuous configs get
missing pieces defaulted (colormap viridis, rescale [0, 1] - the map renders
again and can be re-tuned in the UI); a categorical config with no entries has
nothing to render or repair, so the row is deleted.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "aa8rendfix"
down_revision: str | Sequence[str] | None = "aa7formnorm"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE data.custom_maps
        SET render_config = jsonb_set(render_config, '{colormap_name}', '"viridis"')
        WHERE render_config->>'mode' = 'continuous'
          AND render_config->>'colormap_name' IS NULL
        """
    )
    op.execute(
        """
        UPDATE data.custom_maps
        SET render_config = jsonb_set(render_config, '{rescale}', '[0, 1]')
        WHERE render_config->>'mode' = 'continuous'
          AND (jsonb_typeof(render_config->'rescale') IS DISTINCT FROM 'array'
               OR jsonb_array_length(render_config->'rescale') <> 2)
        """
    )
    op.execute(
        """
        DELETE FROM data.custom_maps
        WHERE render_config->>'mode' = 'categorical'
          AND CASE WHEN jsonb_typeof(render_config->'entries') = 'array'
                   THEN jsonb_array_length(render_config->'entries') = 0
                   ELSE true END
        """
    )


def downgrade() -> None:
    # Repaired defaults are indistinguishable from user choices, and deleted
    # rows are gone.
    pass
