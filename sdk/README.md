# stacnotator-sdk

Python library for active learning with [STACNotator](../README.md) campaign labels: pull
annotated samples into a `pandas.DataFrame`, grow your training set as annotators work, and
push prediction rasters back into the annotation UI as overlay layers.

For a runnable end-to-end walkthrough (train on lat/lon, predict over the campaign extent,
write a COG, register it with a legend, grow the training set), see
[`examples/active-learning-demo.ipynb`](examples/active-learning-demo.ipynb). For the same
round tracked in MLflow (params, metrics, model and COG per run, overlay and run linked in
both directions), see
[`examples/active-learning-mlflow.ipynb`](examples/active-learning-mlflow.ipynb).

## Install

Not published to PyPI yet; install from a checkout of this repo:

```bash
pip install ./sdk                  # from the repo root
```

## Login

```python
import stacnotator as snt

snt.login("https://your-stacnotator.example.org")
```

Pass the app URL (the one you open in the browser); the login handoff tells the SDK where the
API lives, which is a different host in most deployments.
`login` opens your browser on the STACNotator app, where you approve the SDK once. The handoff
only ever targets `127.0.0.1`, and credentials are cached in
`~/.config/stacnotator/credentials.json` (chmod 600, override the directory with
`STACNOTATOR_CONFIG_DIR`). Subsequent sessions reuse the cache; call `snt.logout()` to drop it.
Against a local dev backend (`AUTH_PROVIDER=local`) no browser is needed; `login` detects that
and just works.

## Get labeled samples

```python
campaign = snt.campaign(42)          # snt.campaigns() lists what you can access
campaign.labels                      # {1: "Maize", 2: "Other"}

df = campaign.get_samples()
```

`get_samples()` returns one row per labeled annotation:

| column | meaning |
| --- | --- |
| `annotation_id` | stable id, the key `update_samples` de-duplicates on |
| `task_id` | predefined task the label answers (NA for open-mode annotations) |
| `lat`, `lon` | filled for point samples; NA for polygons/boxes |
| `label_id`, `label` | class id and resolved name |
| `confidence` | annotator-reported 0-10 (NA if unset) |
| `annotator` | annotator email |
| `created_at` | tz-aware timestamp |
| `geometry` | the unchanged GeoJSON geometry |

Geometries are **never** reduced for you: polygon and box samples keep their full geometry and
it is up to you whether to rasterize, take centroids, or sample within them. Skipped tasks
(no label) are excluded. `get_samples(merge_on_agreement=True)` collapses multi-annotator tasks
to one agreed row (the server rejects the export if annotators conflict).

## The active-learning loop

```python
import stacnotator as snt
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split

campaign = snt.campaign(42)
samples = campaign.get_samples()
train, test = train_test_split(samples, test_size=0.2, random_state=42)

while True:
    model = RandomForestClassifier().fit(*featurize(train))
    score = model.score(*featurize(test))       # test set stays fixed across iterations

    predictions_url = export_predictions_cog(model)   # your inference + COG upload
    campaign.register_overlay(
        predictions_url,
        mlops_link="https://mlflow.example.org/#/experiments/7",
    )

    wait_for_annotators()
    train = campaign.update_samples(train, exclude=test)   # only train grows
```

`update_samples(train)` re-fetches the campaign and appends rows whose `annotation_id` is not
in `train` yet; columns you added yourself (features, embeddings, split flags) survive, and new
rows get NA there. Anything passed as `exclude` (here the held-out test set) is never appended,
so the split stays clean while train grows.

`register_overlay` shows your prediction COG as an overlay to annotators. Names are unique
per campaign (a duplicate raises `ApiError` 409); without a `name` it auto-numbers
(`overlay-1`, `overlay-2`, ...) and skips names that are already taken. `mlops_link`
ties the layer to the experiment that produced it (with MLflow, the run URL - see
[`examples/active-learning-mlflow.ipynb`](examples/active-learning-mlflow.ipynb)); annotators
open it via a small link icon next to the overlay selector in the annotation view, and
`campaign.overlays()` lists what's registered.

Most prediction tasks are categorical, so pass `classes` to render discrete values with an
in-app legend instead of a continuous colormap:

```python
campaign.register_overlay(
    "https://blob/crop_mask.tif",
    classes={0: "Non-crop", 1: "Crop"},                      # colors auto-assigned
    # classes={0: ("Non-crop", "#d95f02"), 1: ("Crop", "#1b9e77")}  # or explicit
)
```

Vector data (field boundaries, reference polygons, ...) registers as a PMTiles overlay - the
browser reads the file directly via range requests, so it is usable immediately and needs no
tile server. Annotators toggle vector overlays in open mode:

```python
campaign.register_vector_overlay(
    "https://blob/field_boundaries.pmtiles",
    source_layer="fields",        # one MVT layer from the file; omit to render all
    color="#ff9900",
)
campaign.vector_overlays()        # id, name, pmtiles_url, source_layer, color
```

## Uploading tasks

Predefined-task campaigns need tasks in place before annotators can work. Tasks live in named
task sets (e.g. a first batch, then a "round-2" set once labeling wraps on the first):

```python
campaign.task_sets()   # id, name, num_tasks, num_labeled
```

`upload_tasks` accepts a DataFrame with `lat`/`lon` columns (extra columns become task
properties) or a GeoJSON `FeatureCollection` dict for polygon/box tasks:

```python
points = pd.DataFrame({"lat": [10.0, 11.0], "lon": [20.0, 21.0], "plot": ["a", "b"]})
campaign.upload_tasks(points, task_set="round-2")                        # existing set
campaign.upload_tasks(points, task_set="round-3", create_missing=True)   # created on demand
```

Unknown set names raise `ValueError` listing the campaign's existing sets, unless
`create_missing=True` is passed. Returns the number of tasks created.

## File utils: COGs and PMTiles

Overlays need web-ready files: rasters as Cloud-Optimized GeoTIFFs, vectors as PMTiles.
`stacnotator.utils` converts the outputs pipelines typically produce.

```python
from stacnotator import utils

utils.array_to_cog(preds, campaign.extent, "preds.cog.tif")  # numpy array + bounds -> COG
utils.to_cog("predictions.tif")                      # plain GeoTIFF -> predictions.cog.tif
utils.merge_to_cog("chips/", "predictions.tif")      # folder of inference tiles -> ONE COG
utils.to_pmtiles("fields.gpkg")                      # GeoJSON/GPKG/Shapefile/... -> fields.pmtiles
```

`array_to_cog` covers the common case where predictions are a numpy array in memory: pass
(rows, cols) or (bands, rows, cols) plus (west, south, east, north) bounds - e.g. straight
from `campaign.extent` - and it writes a finished COG, no rasterio boilerplate.

`merge_to_cog` writes each chip into its window of the output, so memory stays flat even for
tens of thousands of chips, and the result has real overviews (fast at every zoom). Overview
resampling defaults to `nearest` (right for class rasters); pass `resampling="average"` for
continuous data. `to_pmtiles` accepts anything GDAL reads and takes `layer`, `min_zoom`,
`max_zoom`. Upload the produced file and register it:

```python
campaign.register_overlay(upload(utils.merge_to_cog("chips/", "run42.tif")), classes=campaign.labels)
campaign.register_vector_overlay(upload(utils.to_pmtiles("fields.gpkg")))
```

## PyTorch

A DataFrame drops straight into a `Dataset`. In the future we will link this up with efficient dataloaders for
the raster data from STAC catalogs for the RISE pipeline.

```python
import torch
from torch.utils.data import Dataset, DataLoader

class CampaignSamples(Dataset):
    def __init__(self, df):
        points = df.dropna(subset=["lat", "lon"])
        self.coords = torch.tensor(points[["lat", "lon"]].to_numpy(dtype="float32"))
        self.labels = torch.tensor(points["label_id"].to_numpy(dtype="int64"))

    def __len__(self):
        return len(self.labels)

    def __getitem__(self, idx):
        return self.coords[idx], self.labels[idx]

loader = DataLoader(CampaignSamples(campaign.get_samples()), batch_size=64, shuffle=True)
```

## API summary

```python
snt.login(url)            # browser-based, cached; returns the logged-in user
snt.logout()
snt.whoami()
snt.campaigns()           # DataFrame: id, name, created_at, is_admin, is_member, is_public
snt.campaign(id)          # -> Campaign

Campaign.get_samples(merge_on_agreement=False)      # -> DataFrame
Campaign.update_samples(train, exclude=None)        # -> train + new rows (exclude stays out)
Campaign.register_overlay(cog_url, name=None, mlops_link=None,
                             rescale=(0.0, 1.0), colormap="viridis",
                             classes=None)       # {value: label} -> categorical + legend
Campaign.overlays()                              # -> DataFrame
Campaign.register_vector_overlay(pmtiles_url, name=None,
                             source_layer=None, color="#3b82f6")
Campaign.vector_overlays()                       # -> DataFrame
Campaign.task_sets()                             # -> DataFrame: id, name, num_tasks, num_labeled
Campaign.upload_tasks(data, task_set, create_missing=False)  # -> num tasks created

utils.array_to_cog(data, bounds, dst, crs="EPSG:4326",
                   nodata=None, resampling="nearest")        # -> Path
utils.to_cog(src, dst=None, resampling="nearest")            # -> Path
utils.merge_to_cog(sources, dst, resampling="nearest")       # folder/list of chips -> Path
utils.to_pmtiles(src, dst=None, layer=None, min_zoom=0, max_zoom=14)  # -> Path
Campaign.labels                                     # {label_id: name}
```

Errors are typed: `NotLoggedInError`, `AuthenticationError` (re-login needed), and
`ApiError` with `.status`/`.detail` (e.g. 403 when you lack access to a campaign).

## Development

```bash
cd sdk
uv sync
uv run pytest          # or from the repo root: make test-sdk
uv run mypy
uv run ruff check src tests
```

## TODOs and improvement ideas

- Version Datasets
- Provide the actual data loading capabilities for the raster data which is STAC
- Link up more strongly with MLFlow (add a MLOps interface with a concrete MLflow implementation) to automate what `examples/active-learning-mlflow.ipynb` currently wires up by hand
