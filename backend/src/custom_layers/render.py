import json

ASSET_KEY = "data"


def build_viz_params(render_config: dict) -> dict:
    mode = render_config.get("mode")
    band = int(render_config.get("band", 1))
    nodata = render_config.get("nodata")

    params: dict = {"assets": [ASSET_KEY], "asset_as_band": True}
    if band != 1:
        params["bidx"] = [band]
    if nodata is not None:
        params["nodata"] = nodata

    if mode == "continuous":
        rescale = render_config.get("rescale")
        colormap_name = render_config.get("colormap_name")
        if not rescale or len(rescale) != 2:
            raise ValueError("continuous render_config requires rescale [min, max]")
        if not colormap_name:
            raise ValueError("continuous render_config requires colormap_name")
        params["rescale"] = f"{rescale[0]},{rescale[1]}"
        params["colormap_name"] = colormap_name
    elif mode == "categorical":
        entries = render_config.get("entries") or []
        if not entries:
            raise ValueError("categorical render_config requires at least one entry")
        cmap = {str(int(e["value"])): _hex_to_rgba(e["color"]) for e in entries}
        params["extra_params"] = {"colormap": json.dumps(cmap)}
    else:
        raise ValueError(f"unknown render mode: {mode!r}")

    return params


def _hex_to_rgba(hex_color: str) -> list[int]:
    h = hex_color.lstrip("#")
    if len(h) == 6:
        h += "ff"
    if len(h) != 8:
        raise ValueError(f"invalid hex color: {hex_color!r}")
    return [int(h[i : i + 2], 16) for i in (0, 2, 4, 6)]
