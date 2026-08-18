"""Integration with external raster tile services (MPC + hosted titiler-pgstac):
which tilers exist (``registry``), how searches are registered and tile URLs built
(``providers``), and the JWTs tilers verify (``tokens``). Nothing here renders a tile.

Looking for how tiles are *served*? Raster tiles come from MPC or the separate
stacnotator-tiler service (docs/tile-serving.md, docs/tilers.md). Annotation vector
tiles (MVT) are rendered by this backend in ``annotation/tiles.py`` + the ``.pbf``
endpoint in ``annotation/router.py``. Provider-key-protected imagery tiles are
proxied by ``imagery/proxy_router.py``. PMTiles custom layers are fetched by the
frontend straight from blob storage.
"""
