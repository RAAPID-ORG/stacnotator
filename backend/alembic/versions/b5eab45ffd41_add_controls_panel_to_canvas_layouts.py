"""add_controls_panel_to_canvas_layouts

Revision ID: b5eab45ffd41
Revises: 748e1a963a72
Create Date: 2026-02-01 15:55:10.164594

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import json

# revision identifiers, used by Alembic.
revision: str = 'b5eab45ffd41'
down_revision: Union[str, Sequence[str], None] = '748e1a963a72'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add controls panel to all existing canvas layouts.
    
    For all main canvas layouts (imagery_id IS NULL):
    1. Resize main panel from w:50 to w:48
    2. Add controls panel at x:48, y:7, w:12, h:13
    3. Adjust minimap to x:48 if needed
    """
    # Get connection
    conn = op.get_bind()
    
    # Query all main canvas layouts (those with imagery_id IS NULL)
    result = conn.execute(sa.text("""
        SELECT id, layout_data 
        FROM data.canvas_layouts 
        WHERE imagery_id IS NULL
    """))
    
    layouts = result.fetchall()
    
    for layout_id, layout_data in layouts:
        if not layout_data or not isinstance(layout_data, list):
            continue
            
        # Track if we need to update
        needs_update = False
        updated_layout = []
        has_controls = False
        
        for item in layout_data:
            if not isinstance(item, dict) or 'i' not in item:
                updated_layout.append(item)
                continue
                
            # Check if controls already exists
            if item['i'] == 'controls':
                has_controls = True
                updated_layout.append(item)
                continue
            
            # Adjust main panel width if it's 50 or larger
            if item['i'] == 'main' and item.get('w', 0) >= 50:
                item = dict(item)  # Create a copy
                item['w'] = 48
                needs_update = True
            
            # Adjust minimap position if needed
            if item['i'] == 'minimap' and item.get('x', 0) >= 50:
                item = dict(item)  # Create a copy
                item['x'] = 48
                needs_update = True
            
            updated_layout.append(item)
        
        # Add controls panel if it doesn't exist
        if not has_controls:
            updated_layout.append({
                "i": "controls",
                "x": 48,
                "y": 7,
                "w": 12,
                "h": 13
            })
            needs_update = True
        
        # Update the layout if changes were made
        if needs_update:
            conn.execute(
                sa.text("""
                    UPDATE data.canvas_layouts 
                    SET layout_data = CAST(:layout_data AS jsonb)
                    WHERE id = :layout_id
                """),
                {"layout_data": json.dumps(updated_layout), "layout_id": layout_id}
            )


def downgrade() -> None:
    """
    Remove controls panel from all canvas layouts and restore original sizes.
    """
    # Get connection
    conn = op.get_bind()
    
    # Query all main canvas layouts
    result = conn.execute(sa.text("""
        SELECT id, layout_data 
        FROM data.canvas_layouts 
        WHERE imagery_id IS NULL
    """))
    
    layouts = result.fetchall()
    
    for layout_id, layout_data in layouts:
        if not layout_data or not isinstance(layout_data, list):
            continue
            
        # Remove controls and restore original dimensions
        updated_layout = []
        
        for item in layout_data:
            if not isinstance(item, dict) or 'i' not in item:
                updated_layout.append(item)
                continue
                
            # Skip controls panel
            if item['i'] == 'controls':
                continue
            
            # Restore main panel width
            if item['i'] == 'main' and item.get('w', 0) == 48:
                item = dict(item)
                item['w'] = 50
            
            # Restore minimap position
            if item['i'] == 'minimap' and item.get('x', 0) == 48:
                item = dict(item)
                item['x'] = 50
            
            updated_layout.append(item)
        
        # Update the layout
        conn.execute(
            sa.text("""
                UPDATE data.canvas_layouts 
                SET layout_data = CAST(:layout_data AS jsonb)
                WHERE id = :layout_id
            """),
            {"layout_data": json.dumps(updated_layout), "layout_id": layout_id}
        )
