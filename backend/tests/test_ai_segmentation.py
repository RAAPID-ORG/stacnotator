
import pytest
from datetime import datetime
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.annotation.ai_segmentation import auto_segment_location_s2

def test_random_location_segmentation():
    # Eiffel Tower, Paris
    location = (2.2945, 48.8584)  # (longitude, latitude)
    start_date = datetime(2025, 6, 1)
    end_date = datetime(2025, 6, 7)
    result = auto_segment_location_s2(
        location=location,
        roi_size=512,
        max_cloud_cover=100.0,
        start_date=start_date,
        end_date=end_date,
    )

    # TODO need to do assertion when i have finsihed this

if __name__ == "__main__":
    test_random_location_segmentation()