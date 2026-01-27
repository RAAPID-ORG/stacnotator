import numpy as np
import planetary_computer
import rasterio
from rasterio.io import MemoryFile
from datetime import datetime
from pystac_client import Client
from samgeo import SamGeo3
from typing import Tuple, Optional, Dict, Any
from rasterio import features
from shapely.geometry import shape
from rasterio.warp import transform_bounds


def load_sentinel2_roi(
    location: Tuple[float, float],
    roi_size: int,
    start_date: datetime = None,
    end_date: datetime = None,
    max_cloud_cover: float = 20.0,
) -> Optional[Tuple[Any, Dict[str, Any]]]:
    """
    Load ROI from Planetary Computer Sentinel-2 L2A STAC catalog as a georeferenced raster.

    Args:
        location: (longitude, latitude) tuple for the center point
        roi_size: Size of the ROI in pixels (square ROI)
        start_date: Start date for imagery search
        end_date: End date for imagery search
        max_cloud_cover: Maximum cloud cover percentage (default: 20%)

    Returns:
        Tuple of (rasterio DatasetReader, metadata dict) or None if no suitable imagery found
        Metadata includes: transform, crs, bounds, etc.
    """

    if start_date is None or end_date is None:
        raise ValueError("start_date and end_date must be provided")

    lon, lat = location

    # Calculate approximate bbox around location
    # Sentinel-2 is ~10m resolution, so calculate degree offset
    meters_per_pixel = 10
    roi_meters = roi_size * meters_per_pixel

    # Approximate conversion (more accurate near equator)
    lat_offset = (roi_meters / 2) / 111320  # meters per degree latitude
    lon_offset = (roi_meters / 2) / (111320 * np.cos(np.radians(lat)))

    bbox = [
        lon - lon_offset,
        lat - lat_offset,
        lon + lon_offset,
        lat + lat_offset,
    ]

    # Connect to Planetary Computer STAC catalog
    catalog = Client.open(
        "https://planetarycomputer.microsoft.com/api/stac/v1",
        modifier=planetary_computer.sign_inplace,
    )

    # Search for Sentinel-2 L2A items
    search = catalog.search(
        collections=["sentinel-2-l2a"],
        bbox=bbox,
        datetime=f"{start_date.isoformat()}Z/{end_date.isoformat()}Z",
        query={"eo:cloud_cover": {"lt": max_cloud_cover}},
    )

    items = list(search.items())
    print(items)
    if not items:
        return None

    # Sort by cloud cover and date (lowest cloud cover, most recent first)
    items.sort(key=lambda x: (x.properties.get("eo:cloud_cover", 100), -x.datetime.timestamp()))
    print(f"Found {len(items)} items")

    t0 = datetime.now()
    band_assets = ["B04", "B03", "B02"]
    scl_asset = "SCL"
    width = roi_size
    height = roi_size
    crs = None
    transform = None
    # Prepare arrays for mosaic: (n_items, 3, H, W), (n_items, H, W) for SCL
    rgb_stack = []
    scl_stack = []
    for item in items:
        band_arrays = []
        for band in band_assets:
            asset_href = item.assets[band].href
            signed_href = planetary_computer.sign(asset_href)
            with rasterio.open(signed_href) as src:
                src_crs = src.crs
                src_transform = src.transform
                if crs is None:
                    crs = src_crs.to_string()
                src_bbox = bbox
                if src_crs.to_string() != "EPSG:4326":
                    src_bbox = transform_bounds("EPSG:4326", src_crs, *bbox, densify_pts=21)
                window = rasterio.windows.from_bounds(
                    *src_bbox, transform=src_transform, width=width, height=height
                )
                arr = src.read(
                    1,
                    window=window,
                    out_shape=(roi_size, roi_size),
                    resampling=rasterio.enums.Resampling.bilinear,
                )
                band_arrays.append(arr)
                if transform is None:
                    transform = rasterio.windows.transform(window, src_transform)
        # Stack bands (3, H, W)
        rgb_stack.append(np.stack(band_arrays, axis=0))
        # Read SCL band for cloud mask
        if scl_asset in item.assets:
            scl_href = planetary_computer.sign(item.assets[scl_asset].href)
            with rasterio.open(scl_href) as src:
                src_crs = src.crs
                src_transform = src.transform
                src_bbox = bbox
                if src_crs.to_string() != "EPSG:4326":
                    src_bbox = transform_bounds("EPSG:4326", src_crs, *bbox, densify_pts=21)
                window = rasterio.windows.from_bounds(
                    *src_bbox, transform=src_transform, width=width, height=height
                )
                scl = src.read(
                    1,
                    window=window,
                    out_shape=(roi_size, roi_size),
                    resampling=rasterio.enums.Resampling.nearest,
                )
                scl_stack.append(scl)
        else:
            scl_stack.append(np.zeros((roi_size, roi_size), dtype=np.uint8))

    rgb_stack = np.array(rgb_stack)  # (n_items, 3, H, W)
    scl_stack = np.array(scl_stack)  # (n_items, H, W)

    print(f"loaded {len(items)} items in {datetime.now() - t0}, starting mosaic..")

    # Mask clouds: SCL values 3, 8, 9, 10, 11 are clouds/shadow/snow
    cloud_mask = ~np.isin(scl_stack, [3, 8, 9, 10, 11])  # True = clear

    # Build mosaic: for each pixel, pick the first clear pixel in stack order
    n_items, n_bands, H, W = rgb_stack.shape
    mosaic = np.zeros((n_bands, H, W), dtype=rgb_stack.dtype)
    for b in range(n_bands):
        band_mosaic = np.zeros((H, W), dtype=rgb_stack.dtype)
        for i in range(n_items):
            mask = cloud_mask[i]
            band = rgb_stack[i, b]
            # Fill only where not already filled and clear
            fill = (band_mosaic == 0) & mask
            band_mosaic[fill] = band[fill]
        mosaic[b] = band_mosaic

    # If any pixels remain zero (never clear), fill with first available (cloudy) pixel
    for b in range(n_bands):
        band_mosaic = mosaic[b]
        for i in range(n_items):
            band = rgb_stack[i, b]
            fill = band_mosaic == 0
            band_mosaic[fill] = band[fill]
        mosaic[b] = band_mosaic

    # Normalize to 0-255 range for SAM
    mosaic = np.nan_to_num(mosaic, nan=0.0)
    rgb_bands_normalized = np.clip(mosaic / 10000.0 * 255, 0, 255).astype(np.uint8)
    print(f"Loaded and mosaicked imagery in {datetime.now() - t0}")

    # Create in-memory raster with proper georeferencing
    metadata = {
        "driver": "GTiff",
        "dtype": "uint8",
        "width": roi_size,
        "height": roi_size,
        "count": 3,  # RGB
        "crs": crs,
        "transform": transform,
        "bounds": bbox,
        "nodata": None,
    }

    # Create memory file with georeferenced raster
    memfile = MemoryFile()
    with memfile.open(**metadata) as dataset:
        # Write RGB bands
        for i in range(3):
            dataset.write(rgb_bands_normalized[i], i + 1)

    # Return the dataset and metadata
    # Note: We need to keep memfile alive, so return it too
    dataset = memfile.open()
    metadata["memfile"] = memfile  # Keep reference to prevent garbage collection

    return dataset, metadata


# TODO make more generic for other stac catalogs and collections.


def auto_segment_location_s2(
    location: Tuple[float, float],
    roi_size: int = 512,
    max_cloud_cover: float = 20.0,
    start_date: datetime = None,
    end_date: datetime = None,
) -> Optional[Dict[str, Any]]:
    """
    Automatically segment objects at a location using SAM on Sentinel-2 imagery.
    Works with georeferenced rasters throughout and converts to polygon at the end.

    Args:
        location: (longitude, latitude) tuple for the center point to segment
        roi_size: Size of the ROI in pixels (default: 512)
        max_cloud_cover: Maximum cloud cover percentage for tiles (default: 20%)
        start_date: Start date for imagery search
        end_date: End date for imagery search

    Returns:
        Dictionary containing segmentation results with masks, polygons, and metadata
    """
    # Load ROI from Sentinel-2 as georeferenced raster
    raise NotImplementedError("Not finished implementing yet.")
    result = load_sentinel2_roi(
        location,
        roi_size,
        max_cloud_cover=max_cloud_cover,
        start_date=start_date,
        end_date=end_date,
    )

    if result is None:
        return None

    dataset, metadata = result

    # Read RGB data as (H, W, C) for SAM
    rgb_image = np.dstack(
        [
            dataset.read(1),  # Red
            dataset.read(2),  # Green
            dataset.read(3),  # Blue
        ]
    )

    # Calculate the center point in pixel coordinates
    center_y, center_x = roi_size // 2, roi_size // 2
    point_prompt = [[center_x, center_y]]

    # Perform segmentation (SAM needs numpy array)
    sam_result = segment_sam_geo(
        rgb_image,
        point_prompt=point_prompt,
    )

    # Now convert masks to polygons using the georeferencing from rasterio
    masks = sam_result["masks"]
    scores = sam_result["scores"]
    polygons = []

    for mask in masks:
        # Convert mask to uint8
        mask_uint8 = mask.astype(np.uint8)

        # Extract shapes with proper georeferencing
        shapes_list = list(
            features.shapes(mask_uint8, mask=mask_uint8 > 0, transform=metadata["transform"])
        )

        if len(shapes_list) > 0:
            # Get the largest polygon
            polys = [shape(geom) for geom, value in shapes_list]
            largest_poly = max(polys, key=lambda p: p.area)

            # Simplify and convert to WKT
            simplified = largest_poly.simplify(tolerance=0.00001, preserve_topology=True)
            polygons.append(simplified.wkt)
        else:
            # Fallback to center point
            lon, lat = location
            offset = 0.0001
            fallback_wkt = f"POLYGON(({lon - offset} {lat - offset}, {lon + offset} {lat - offset}, {lon + offset} {lat + offset}, {lon - offset} {lat + offset}, {lon - offset} {lat - offset}))"
            polygons.append(fallback_wkt)

    # Close the dataset
    dataset.close()

    return {
        "masks": masks,
        "scores": scores,
        "logits": sam_result["logits"],
        "polygons": polygons,  # WKT polygons with proper georeferencing
        "image_shape": rgb_image.shape,
        "transform": metadata["transform"],
        "crs": str(metadata["crs"]),
        "bounds": metadata["bounds"],
    }


def segment_sam_geo(
    image: np.ndarray,
    point_prompt: Optional[list] = None,
    point_labels: Optional[list] = None,
    point_crs: Optional[str] = "pixel",
    box_prompt: Optional[list] = None,
    box_crs: Optional[str] = "pixel",
    text_prompt: Optional[str] = None,
    output_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Perform segmentation using SAM (Segment Anything Model) via samgeo
    Simplified some functions from: https://github.com/opengeos/segment-geospatial/blob/main/samgeo/samgeo3.py

    Args:
        image: RGB image as numpy array (H, W, 3)
        point_prompt: List of [x, y] points for point-based prompting
        point_labels: List of labels (1 for positive, 0 for negative) corresponding to point_prompt
        point_crs: Coordinate reference system for point prompts ("pixel" or EPSG code)
        box_prompt: Bounding box [x_min, y_min, x_max, y_max] for box-based prompting. Single box only currently.
        box_crs: Coordinate reference system for box prompt ("pixel" or EPSG code)
        text_prompt: Text prompt for text-based segmentation
        output_path: Optional path to save segmentation masks

    Returns:
        Dictionary containing:
            - masks: Segmentation masks as numpy array
            - scores: Confidence scores for each mask
            - logits: Raw logits from the model
    """

    # Initialize SamGeo with appropriate device
    sam = SamGeo3(
        backend="meta",
        enable_inst_interactivity=True,
        device=None,
        checkpoint_path=None,
        load_from_HF=True,
    )

    # Set the image
    sam.set_image(image)

    # Generate masks based on prompts
    if point_prompt is not None:
        # Convert point prompts to the format expected by samgeo
        point_coords = np.array(point_prompt)
        if point_labels is None:
            point_labels = [1] * len(point_prompt)  # Default all to positive points

        masks, scores, logits = sam.predict_inst(
            point_coords=point_coords,
            point_labels=point_labels,
            multimask_output=True,
            point_crs=point_crs,
        )
    elif box_prompt is not None:
        masks, scores, logits = sam.predict_inst(
            boxes=[box_prompt],
            multimask_output=True,
            box_crs=box_crs,
        )
    elif text_prompt is not None:
        sam.processor.reset_all_prompts(sam.inference_state)
        output = sam.processor.set_text_prompt(state=sam.inference_state, prompt=text_prompt)
        masks = output["masks"]
        scores = output["scores"]
        logits = output["logits"]
    else:
        raise ValueError(
            "At least one of point_prompt, box_prompt, or text_prompt must be provided."
        )

    # Optionally save results
    if output_path is not None:
        sam.save_masks(output_path)

    return {
        "masks": masks,
        "scores": scores,
        "logits": logits,
        "image_shape": image.shape,
    }
