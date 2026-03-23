# TiTiler-MPC (simple)

Minimal compositing tile server for Planetary Computer.
No pgSTAC, no local metadata catalogue, no moving parts beyond the container itself.

## How it works

Your JS app already searches MPC and has a list of STAC item URLs.
Pass them directly to this service as tile requests:

```
GET /composite/{z}/{x}/{y}.png
    ?items=https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-2-l2a/items/item-1
    &items=https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-2-l2a/items/item-2
    &assets=B04,B03,B02
    &pixel_selection=median
    &rescale=0,3000
```

TiTiler signs each item URL, fetches only the COG bytes it needs from
Azure Blob Storage via HTTP range requests, and returns a composited PNG.

## Leaflet / MapLibre integration

Because the item list is in the query string, you can't use a simple
XYZ template URL. Instead, intercept tile requests and inject the params:

```javascript
// MapLibre example
map.addSource("composite", {
  type: "raster",
  tiles: [buildTileUrl],   // see below
  tileSize: 256,
});

function buildTileUrl(z, x, y) {
  const base = "http://your-titiler/composite";
  const items = yourMpcSearchResults
    .map(item => `items=${encodeURIComponent(item.links.self)}`)
    .join("&");
  return `${base}/${z}/${x}/${y}.png?${items}&assets=B04,B03,B02&pixel_selection=median&rescale=0,3000`;
}
```

## Running locally

```bash
docker compose up --build
# Service available at http://localhost:8000
# Swagger UI at http://localhost:8000/docs
```

## Deploying to Kubernetes

```bash
# Build and push
docker build -t your-registry/titiler-mpc:latest ./titiler
docker push your-registry/titiler-mpc:latest

# Edit k8s/manifests.yaml — set your image name and domain
kubectl apply -f k8s/manifests.yaml
```

## Query parameters

| Parameter         | Default    | Description                                         |
|-------------------|------------|-----------------------------------------------------|
| `items`           | (required) | MPC STAC item URLs. Repeat for each item.           |
| `assets`          | B04,B03,B02| Asset keys to fetch                                 |
| `pixel_selection` | `median`   | `median`, `mean`, `first`, `highest`, `lowest`, `stdev` |
| `rescale`         | `0,3000`   | Input range stretched to 0-255 for PNG output       |

## Performance notes

- Each tile request signs + fetches N item URLs concurrently via `mosaic_reader`
- GDAL range requests mean only the bytes for the requested tile are fetched
- The GDAL tile cache (`CPL_VSIL_CURL_CACHE_SIZE`) reduces repeat fetches for
  adjacent tiles that share COG data
- If the same search is requested repeatedly, consider caching the tile PNG
  response at your reverse proxy / CDN layer rather than inside this service
