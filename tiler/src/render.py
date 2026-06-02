"""Shared post-processing: rescale → color formula → colormap → PNG bytes."""

import struct
import zlib

from rio_tiler.colormap import cmap as rio_cmap
from rio_tiler.models import ImageData


def render_png(
    img: ImageData,
    rescale: list[str],
    color_formula: str | None,
    colormap_name: str | None,
) -> bytes:
    if rescale:
        in_range = []
        for r in rescale:
            parts = r.split(",")
            if len(parts) == 2:
                in_range.append((float(parts[0]), float(parts[1])))
        if in_range:
            img.rescale(in_range=in_range)

    if color_formula:
        img.apply_color_formula(color_formula)

    render_kwargs: dict = {}
    if colormap_name:
        render_kwargs["colormap"] = rio_cmap.get(colormap_name)

    return img.render(img_format="PNG", **render_kwargs)


_EMPTY_TILE_BYTES: bytes | None = None


def empty_tile() -> bytes:
    global _EMPTY_TILE_BYTES
    if _EMPTY_TILE_BYTES is not None:
        return _EMPTY_TILE_BYTES

    width, height = 256, 256
    raw_data = b"\x00" + b"\x00\x00\x00\x00" * width
    raw_rows = raw_data * height
    compressed = zlib.compress(raw_rows)

    def _chunk(chunk_type: bytes, data: bytes) -> bytes:
        c = chunk_type + data
        crc = struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + c + crc

    png = b"\x89PNG\r\n\x1a\n"
    png += _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += _chunk(b"IDAT", compressed)
    png += _chunk(b"IEND", b"")

    _EMPTY_TILE_BYTES = png
    return _EMPTY_TILE_BYTES
