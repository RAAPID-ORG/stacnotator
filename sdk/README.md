# stacnotator-sdk

Python library for active learning with [STACNotator](../README.md) campaign labels: pull
annotated samples into a `pandas.DataFrame`, grow your training set as annotators work, and
push prediction maps back into the annotation UI.

The library is notebook-first: no CLI, no config files to write, no passwords in code.

## Install

```bash
pip install stacnotator-sdk        # from a checkout: pip install ./sdk
```

## Login

```python
import stacnotator as snt

snt.login("https://your-stacnotator.example.org")
```

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
    campaign.register_pred_layer(
        predictions_url,
        mlops_link="https://mlflow.example.org/#/experiments/7",
    )

    wait_for_annotators()
    train = campaign.update_samples(train, exclude=test)   # only train grows
```

`update_samples(train)` re-fetches the campaign and appends rows whose `annotation_id` is not
in `train` yet; columns you added yourself (features, embeddings, split flags) survive, and new
rows get NA there. Anything passed as `exclude` (here the held-out test set) is never appended,
so the split stays clean while train grows. `register_pred_layer` shows your prediction COG as
an overlay to annotators; without a `name` it auto-numbers (`prediction-1`, `prediction-2`,
...), and `mlops_link` ties the layer to the experiment that produced it.
`campaign.pred_layers()` lists what's registered.

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
Campaign.register_pred_layer(cog_url, name=None, mlops_link=None,
                             rescale=(0.0, 1.0), colormap="viridis")
Campaign.pred_layers()                              # -> DataFrame
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
