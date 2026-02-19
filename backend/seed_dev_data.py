#!/usr/bin/env python3
"""
Development database seeding script.
Creates a sample campaign with imagery, tasks, and users for quick development.

Usage:
    python seed_dev_data.py              # Seed the database
    python seed_dev_data.py clear        # Clear seed data
    python seed_dev_data.py FIREBASE_UID # Seed with specific Firebase UID
"""

import sys
from datetime import datetime, timedelta
from sqlalchemy import select

from src.database import SessionLocal
from src.auth.models import User, UserRole
from src.campaigns.models import Campaign, CampaignSettings, CampaignUser, CanvasLayout
from src.campaigns.constants import DEFAULT_CAMPAIGN_MAIN_CANVAS_LAYOUT
from src.imagery.models import Imagery, ImageryWindow, ImageryVisualizationUrlTemplate
from src.annotation.models import AnnotationTask, AnnotationTaskAssignment, AnnotationGeometry
from src.timeseries.models import TimeSeries
from src.auth.constants import ROLE_ADMIN, ROLE_APPROVED


def seed_dev_data(firebase_uid: str = None):
    """Seed development data into the database.
    
    Args:
        firebase_uid: Optional Firebase UID. If not provided, uses a test UID.
                     In production, pass the actual Firebase UID from authentication.
    """
    
    db = SessionLocal()
    try:
        print("Starting database seeding...")
        
        # Check if data already exists
        existing_campaign = db.execute(
            select(Campaign).where(Campaign.name == "Dev Test Campaign")
        ).scalar_one_or_none()
        
        if existing_campaign:
            print("Dev campaign already exists. Deleting and recreating...")
            db.delete(existing_campaign)
            db.commit()
        
        # Use provided Firebase UID or default test UID
        if firebase_uid is None:
            firebase_uid = "dev-test-uid"
            print(f"No Firebase UID provided, using test UID: {firebase_uid}")
        
        # Create or get user with the Firebase UID
        user = db.execute(
            select(User).where(User.issuer == "firebase").where(User.external_uid == firebase_uid)
        ).scalar_one_or_none()
        
        if not user:
            print(f"Creating user with Firebase UID: {firebase_uid}")
            user = User(
                issuer="firebase",
                external_uid=firebase_uid,
                email=f"dev-{firebase_uid}@test.com",
                display_name="Dev Test User"
            )
            db.add(user)
            db.flush()
            
            # Add approved and admin roles
            approved_role = UserRole(
                user_id=user.id,
                role=ROLE_APPROVED
            )
            db.add(approved_role)
            
            admin_role = UserRole(
                user_id=user.id,
                role=ROLE_ADMIN
            )
            db.add(admin_role)
            db.flush()
        else:
            print(f"Using existing user: {user.email}")
            # Ensure user has approved and admin roles
            if not user.is_approved:
                print(f"Adding approved role to user...")
                approved_role = UserRole(
                    user_id=user.id,
                    role=ROLE_APPROVED
                )
                db.add(approved_role)
            
            if not user.is_admin:
                print(f"Adding admin role to user...")
                admin_role = UserRole(
                    user_id=user.id,
                    role=ROLE_ADMIN
                )
                db.add(admin_role)
            
            db.flush()
        
        # Create campaign
        print("Creating campaign...")
        campaign = Campaign(
            name="Dev Test Campaign",
            mode="tasks"  # "tasks" or "open"
        )
        db.add(campaign)
        db.flush()
        
        # Create campaign settings
        print("Creating campaign settings...")
        settings = CampaignSettings(
            campaign_id=campaign.id,
            labels=[
                {
                    "id": 1,
                    "name": "Building",
                    "description": "Buildings and structures"
                },
                {
                    "id": 2,
                    "name": "Road",
                    "description": "Roads and paths"
                },
                {
                    "id": 3,
                    "name": "Tree",
                    "description": "Individual trees"
                },
                {
                    "id": 4,
                    "name": "Water",
                    "description": "Water bodies"
                }
            ],
            # Bounding box around San Francisco area
            bbox_west=-122.5,
            bbox_south=37.7,
            bbox_east=-122.3,
            bbox_north=37.8
        )
        db.add(settings)
        
        # Add user to campaign
        print("Adding user to campaign...")
        campaign_user = CampaignUser(
            campaign_id=campaign.id,
            user_id=user.id,
            is_admin=True,  # Make user admin of the campaign
            is_authorative_reviewer=False
        )
        db.add(campaign_user)
        
        # Create imagery source
        print("Creating imagery source...")
        
        # Planetary Computer Sentinel-2 mosaic configuration
        imagery = Imagery(
            campaign_id=campaign.id,
            name="Sentinel-2 RGB",
            start_ym="202401",  # January 2024
            end_ym="202412",  # December 2024
            window_interval=1,
            window_unit="months",
            slicing_interval=1,
            slicing_unit="weeks",
            crosshair_hex6="FF0000",
            default_zoom=14,
            registration_url="https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register",
            search_body={
                "bbox": "{campaignBBoxPlaceholder}",
                "filter": {
                    "op": "and",
                    "args": [
                        {
                            "op": "anyinteracts",
                            "args": [
                                {"property": "datetime"},
                                {"interval": ["{startDatetimePlaceholder}", "{endDatetimePlaceholder}"]}
                            ]
                        },
                        {
                            "op": "<=",
                            "args": [{"property": "eo:cloud_cover"}, 70]
                        },
                        {
                            "op": "=",
                            "args": [{"property": "collection"}, "sentinel-2-l2a"]
                        }
                    ]
                },
                "metadata": {
                    "type": "mosaic",
                    "maxzoom": 24,
                    "minzoom": 0,
                    "pixel_selection": "median"
                },
                "filterLang": "cql2-json",
                "collections": ["sentinel-2-l2a"]
            },
            default_main_window_id=None  # Will be set after creating windows
        )
        db.add(imagery)
        db.flush()
        
        # Add visualization URL templates
        from src.imagery.models import ImageryVisualizationUrlTemplate
        
        viz_true_color = ImageryVisualizationUrlTemplate(
            imagery_id=imagery.id,
            name="True Color",
            visualization_url="https://planetarycomputer.microsoft.com/api/data/v1/mosaic/{searchId}/tiles/WebMercatorQuad/{z}/{x}/{y}?assets=B04&assets=B03&assets=B02&nodata=0&color_formula=Gamma+RGB+3.2+Saturation+0.8+Sigmoidal+RGB+25+0.35&collection=sentinel-2-l2a&pixel_selection=median"
        )
        db.add(viz_true_color)
        
        viz_false_color = ImageryVisualizationUrlTemplate(
            imagery_id=imagery.id,
            name="False Color Infrared",
            visualization_url="https://planetarycomputer.microsoft.com/api/data/v1/mosaic/{searchId}/tiles/WebMercatorQuad/{z}/{x}/{y}?assets=B08&assets=B04&assets=B03&nodata=0&color_formula=Gamma+RGB+3.7+Saturation+1.5+Sigmoidal+RGB+15+0.35&collection=sentinel-2-l2a&pixel_selection=median"
        )
        db.add(viz_false_color)
        
        # Create imagery windows
        print("Creating imagery windows...")
        
        # Create 3 monthly windows
        windows = []
        for i in range(3):
            month = 1 + i  # Jan, Feb, Mar 2024
            start_date = f"20240{month}01"
            if month < 3:
                end_date = f"20240{month + 1}01"
            else:
                end_date = "20240401"
            
            window = ImageryWindow(
                imagery_id=imagery.id,
                window_index=i,
                window_start_date=start_date,
                window_end_date=end_date
            )
            db.add(window)
            windows.append(window)
        
        db.flush()
        
        # Set default main window
        imagery.default_main_window_id = windows[1].id  # Use middle window as default
        
        # Create default main canvas layout for the campaign
        print("Creating main canvas layout for campaign...")
        main_canvas_layout = CanvasLayout(
            layout_data=DEFAULT_CAMPAIGN_MAIN_CANVAS_LAYOUT.copy(),
            user_id=None,
            campaign_id=campaign.id,
            imagery_id=None,  # Main campaign layout
            is_default=True,
        )
        db.add(main_canvas_layout)
        
        # Create imagery-specific canvas layout with windows
        print("Creating canvas layout for imagery...")
        
        # Build layout data with windows arranged in a row
        imagery_layout_data = []
        window_width = 10
        window_height = 8
        x_offset = 0
        
        for window in windows:
            layout_entry = {
                "i": f"{window.id}",
                "x": x_offset,
                "y": 0,
                "w": window_width,
                "h": window_height,
            }
            imagery_layout_data.append(layout_entry)
            x_offset += window_width  # Place windows side by side
        
        imagery_canvas_layout = CanvasLayout(
            layout_data=imagery_layout_data,
            user_id=None,
            campaign_id=campaign.id,
            imagery_id=imagery.id,
            is_default=True,
        )
        db.add(imagery_canvas_layout)
        
        # Create sample annotation tasks
        print("Creating annotation tasks...")
        
        # Sample points around San Francisco
        sample_points = [
            (-122.4194, 37.7749),  # Downtown SF
            (-122.4383, 37.7694),  # Golden Gate Park area
            (-122.4156, 37.7833),  # North Beach
            (-122.3978, 37.7911),  # Pier 39 area
            (-122.4297, 37.7599),  # Mission District
            (-122.4408, 37.7858),  # Richmond District
            (-122.3892, 37.7694),  # Potrero Hill
            (-122.4231, 37.8025),  # Fisherman's Wharf
            (-122.4064, 37.7947),  # Telegraph Hill
            (-122.4483, 37.7881),  # Outer Richmond
        ]
        
        for idx, (lon, lat) in enumerate(sample_points, start=1):
            # Create geometry first
            geom = AnnotationGeometry(
                geometry=f"SRID=4326;POINT({lon} {lat})"
            )
            db.add(geom)
            db.flush()  # Get the geometry ID
            
            # Create task with geometry reference
            task = AnnotationTask(
                campaign_id=campaign.id,
                annotation_number=idx,
                geometry_id=geom.id,
            )
            db.add(task)
            db.flush()  # Get the task ID
            
            # Assign task to user
            assignment = AnnotationTaskAssignment(
                task_id=task.id,
                user_id=user.id,
            )
            db.add(assignment)
        
        db.commit()
        
        print("\nDatabase seeding complete!")
        print(f"Campaign ID: {campaign.id}")
        print(f"Campaign Name: {campaign.name}")
        print(f"User: {user.email}")
        print(f"Firebase UID: {user.external_uid}")
        print(f"Imagery: {imagery.name}")
        print(f"Tasks created: {len(sample_points)}")
        print(f"Labels: {len(settings.labels)}")
        
    finally:
        db.close()


def clear_dev_data():
    """Clear development data from the database."""
    db = SessionLocal()
    try:
        print("Clearing development data...")
        
        campaign = db.execute(
            select(Campaign).where(Campaign.name == "Dev Test Campaign")
        ).scalar_one_or_none()
        
        if campaign:
            db.delete(campaign)
            db.commit()
            print("Development campaign deleted.")
        else:
            print("No development campaign found.")
            
    finally:
        db.close()


def main():
    """Main entry point."""
    
    if len(sys.argv) > 1 and sys.argv[1] == "clear":
        clear_dev_data()
    elif len(sys.argv) > 1:
        # Use provided Firebase UID
        firebase_uid = sys.argv[1]
        seed_dev_data(firebase_uid)
    else:
        # Use default test UID
        seed_dev_data()


if __name__ == "__main__":
    main()
