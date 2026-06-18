# Tiling architecture

STACNotator doesn't do the tile serving by itself. It provides a unified interface to load tiles, from tilers such as the
Microsoft Planetary Computer or a self-hosted [titiler-pgstac](https://github.com/RAAPID-ORG/stacnotator-tiler) that we provide
a template for.

## Two providers

A visualization of a collection is served by one of two providers:

| Provider | What it is | When it's used |
|---|---|---|
| **MPC** | Microsoft Planetary Computer's own tiler. Direct, free egress; serves only MPC-catalog data. | The catalog is MPC **and** the viz is MPC-eligible (first-valid compositing, no masking). |
| **hosted** | A self-hosted [titiler-pgstac](https://github.com/RAAPID-ORG/stacnotator-tiler) tiler (TiTiler + GDAL over a pgstac index). Composites, masks, and signs private-bucket reads. | Everything else: non-MPC catalogs, or MPC catalogs with compositing/masking. |

The provider is chosen automatically from the catalog and viz params (`select_provider` in
`backend/src/tiling/providers.py`). MPC is special only here, in *routing* - it's a separate
service that can only serve its own catalog, so it can't be "just another hosted tiler."

There can be **many** hosted tilers (e.g. one on Azure, one on a GCP VM). Each is an
independent deployment with its **own pgstac** - data in one isn't in the other. This lets a
tiler sit next to its data and serve any STAC catalog quickly.

## Tilers and their flags

`backend/src/tiling/registry.py` is the single source of truth for which tilers exist. MPC and
every hosted tiler are described uniformly, each with a few flags:

- **`is_default` - the *default tiler*.** Exactly one hosted tiler (`Settings.DEFAULT_TILER`).
  It answers *"which hosted tiler renders a collection that didn't pick one?"* - a **routing**
  default. Typicallt used to tile external stac collections that are not self managed.
- **`default_access` - *default access*.** The tilers a user may use without being granted them
  (MPC + the default tiler). It answers *"which tilers is a new user allowed to use?"* - an
  **authorization** default; these are seeded into each user's allowed set.
- **`stac_url`** - if set, the tiler exposes a browsable STAC catalog (see below).

So the default tiler is *also* default-access, but the two concepts are different axes: one is
about which tiler serves a collection, the other about which tilers a user may touch. Hosted
tilers (and their flags) come from the `TILERS` env var; adding one is config-only.

## Per-collection tiler selection

A collection can name which hosted tiler it uses (`stac_config.tiler`); unset means the default
tiler. Collections saved together can target different tilers. In the wizard the tiler is
normally set automatically by the catalog you browse (next section); an **Advanced → Tile
server** dropdown lets you override it for non-MPC collections.

## Browsable catalogs

A hosted tiler with a `stac_url` runs a small read-only STAC API (`stac-fastapi-pgstac`) over
its pgstac, so its collections can be **browsed** in the wizard - this is how a preloaded tiler
(data ingested directly, no external catalog) becomes usable.

The STAC API exposes metadata only (item footprints, dates, and *unsigned* asset URLs); the
bucket stays private and only the tiler signs reads, so no imagery is downloadable through it.

## Per-user tiler authorization

Each user has **one allowed-tiler set**. The default-access tilers are seeded into it for every
new user (and backfilled for existing users by migration); platform admins can then toggle any
tiler on or off per user - including the defaults - under **Settings → User management → Tile
access**. When imagery is saved, a collection targeting a tiler the user isn't allowed is
rejected before anything is written. This gates *who may set up imagery on a tiler*; it does
not gate viewing (below).

## Viewing (campaign-scoped)

The backend mints a short-lived HS256 cookie carrying the user's campaigns, signed with a
secret **shared by the backend and all tilers**. A tiler serves a tile only if the search's
`campaign_id` (stamped at registration) is in the token - so users see only their campaigns'
imagery, and only data actually registered on that tiler. A tiler is therefore part of one
trusted deployment, not a third-party service: it must share `TILER_TOKEN_SECRET` with the
backend and sit on a subdomain of the app so the cookie reaches it.

Known trade-offs (intentionally simple for now): a single shared secret works across all
tilers, and a campaign's tiler access is implicit (it's "on" a tiler once data is registered
there). In the future we might want to switch to asymetric keys.

## Deploying a tiler

1. Deploy the tiler with its own pgstac, sharing `TILER_TOKEN_SECRET`, CORS set to the app
   origin, on a subdomain under `PUBLIC_DOMAIN` (so the cookie reaches it).
2. Register it in the backend via `TILERS` / `EXTRA_TILERS` (+ `DEFAULT_TILER`). Include a
   `stac_url` to make it browsable, e.g.
   `"tiler-gcp":{"url":"https://tiler-gcp.dev.stacnotator.io","stac_url":"https://tiler-gcp.dev.stacnotator.io/stac","allows_ingest":false}`.
   On Azure this is wired through `azure_deploy/deploy-app.sh` / GitHub Actions vars.
3. Ingest data; grant the tiler to the relevant users if it isn't a default; then pick it on a
   collection (or browse its catalog).

The standalone tiler service lives in its own repo:
[stacnotator-tiler](https://github.com/RAAPID-ORG/stacnotator-tiler) (see its README and
`docs/database.md` for the pgstac bootstrap and keyless GCS signing).
