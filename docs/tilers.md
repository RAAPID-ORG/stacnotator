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
`backend/src/tilers/providers.py`). MPC is special only here, in *routing* - it's a separate
service that can only serve its own catalog, so it can't be "just another hosted tiler."

There can be **many** hosted tilers (e.g. one on Azure, one on a GCP VM). Each is an
independent deployment with its **own pgstac** - data in one isn't in the other. This lets a
tiler sit next to its data and serve any STAC catalog quickly.

## Asset access (Layer 2): how the hosted tiler reads private COGs

Routing (above) picks *which* tiler renders a collection. Separately, when the hosted tiler
renders a tile it has to fetch the underlying COG bytes, and those usually sit in a **private**
bucket. The STAC item stores only the bare, unsigned asset URL; the tiler signs a short-lived
read URL per asset at render time, dispatched by host. This lives in the tiler repo
(`src/tiler/signing.py`, `sign_asset`):

| Asset host | How the tiler reads it | Credential used |
|---|---|---|
| **GCS** (`gs://`, `storage.googleapis.com`) | Keyless V4 signed URL via IAM `signBlob` (`gcp.py`). | The tiler's **GCP service account** (needs read on the bucket + `serviceAccountTokenCreator` on itself). |
| **Azure Blob** (internal-storage COGs) | Keyless read-only **user-delegation SAS** (`azure.py`), applied only to searches stamped `asset_signer: "azure_managed_identity"`. | The tiler's **Azure managed identity** (needs `Storage Blob Data Reader` on the owner's account, granted in Azure - not configured here). |
| **MPC** (`planetarycomputer.microsoft.com` and its `*.blob.core.windows.net` data assets) | Short-lived SAS via `planetary_computer.sign`. | **None of the tiler's** - MPC's public token API, which only mints a SAS for accounts MPC manages. |
| **Anything else** (e.g. public AWS `sentinel-cogs`) | Passed through unsigned; GDAL reads it directly. | None. |

Key point: signing happens **server-side only** - the browser never receives the COG URL, the
signed URL, or any storage credential. It sees only `/searches/{id}/tiles/...` from the tiler.

### How the Azure managed-identity read is gated

Three independent things must all hold before the tiler reads a blob with its identity. They sit
on different axes, so none is redundant:

- **Routing - is *this search's data* meant for the identity?** Internal-storage searches are
  stamped with a generic `asset_signer: "azure_managed_identity"` marker in their pgstac
  metadata at registration (`tilers/providers.py`). MPC/mosaic searches carry no marker, and the
  tiler applies the identity signer only to marked searches. This is what lets **one tiler serve
  both** MPC composites and internal-storage COGs: an MPC search is unmarked, so its
  `*.blob.core.windows.net` assets stay on the `planetary_computer` path - no host-based
  ambiguity.
- **Authorization - who may *create* such a search?** Only organizations cleared for it: marking
  imagery or a custom map as internal storage is rejected (403) unless
  `Organization.allows_internal_storage` is set (checked in `imagery/router.py` and
  `custom_layers/router.py`). Platform admins set the flag per organization.
- **What** the identity can actually read is then **Azure RBAC** - project admins grant it
  `Storage Blob Data Reader` on their own accounts. Nothing is read that wasn't granted in Azure.

`AZURE_SIGNING_ENABLED` on the tiler is a per-deployment kill switch for the whole path.

### The residual risk we're accepting (for now)

The signer still signs whatever asset URL is in the STAC item, with no check that the blob belongs
to the campaign requesting the tile. What we've done is shrink the set of people who can *trigger*
a managed-identity read to admins of organizations explicitly cleared for internal storage. So:

> An admin in an `allows_internal_storage` organization can register a custom map whose `cog_url`
> points at **any account the tiler's identity has been granted**, including one meant for another
> project - and get it rendered. Admins of other organizations cannot (their registration is
> rejected).

That's an accepted trade-off: the flag is only granted to trusted, first-party organizations.
Isolation *between* projects therefore rests on two things: granting the identity only the
accounts you intend (RBAC), and trusting the orgs holding the flag. If projects ever need to be
hard tenancy boundaries, the durable fix is per-campaign credentials (the tiler reads each
project's storage with that project's own SAS/identity), which removes the shared deputy entirely.

> Separately, `cog_url` is otherwise unvalidated, so a user who may register custom maps can also
> make the tiler issue GET requests to arbitrary hosts (SSRF from the tiler's network position).
> Host/scheme allowlisting of `cog_url` on the backend is tracked separately.

## Tilers and their flags

`backend/src/tilers/registry.py` is the single source of truth for which tilers exist. MPC and
every hosted tiler are described uniformly, each with a few flags:

- **`is_default` - the *default tiler*.** At most one hosted tiler (`Settings.DEFAULT_TILER`,
  optional - unset means none, the MPC-only deploy). It answers *"which hosted tiler renders a
  collection that didn't pick one?"* - a **routing** default. Typically used to tile external
  stac collections that are not self managed.
- **`default_access` - *default access*.** The tilers an organization may use without being
  granted them (MPC + the default tiler). It answers *"which tilers is a newly approved
  organization allowed to use?"* - an **authorization** default; these are seeded into each
  organization's allowed set on approval.
- **`stac_url`** - if set, the tiler exposes a browsable STAC catalog (see below).

So the default tiler is *also* default-access, but the two concepts are different axes: one is
about which tiler serves a collection, the other about which tilers an organization may touch.
Hosted tilers (and their flags) come from the `TILERS` env var; adding one is config-only.

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

## Per-organization tiler authorization

Each organization has **one allowed-tiler set** (`Organization.allowed_tiler_names`). The
default-access tilers are seeded into it when the organization is approved; platform admins can
then toggle any tiler on or off per organization - including the defaults - under **Settings →
Organizations → Tile access** (`PUT /organizations/{id}/tilers`). When imagery is saved, a
collection targeting a tiler the campaign's organization isn't allowed is rejected before
anything is written. This gates *who may set up imagery on a tiler*; it does not gate viewing
(below).

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
   On Azure this is wired through `deployment/azure/deploy.sh` / GitHub Actions variables.
3. Ingest data; grant the tiler to the relevant organizations if it isn't a default; then pick
   it on a collection (or browse its catalog).
4. For asset signing, give the tiler read on **only** the data it serves and configure it
   accordingly (see "Asset access" above):
   - GCS: attach a service account with read on the prediction bucket; leave
     `GCS_SIGNER_SERVICE_ACCOUNT` unset to auto-detect it.
   - Azure: set `AZURE_SIGNING_ENABLED=true` on the custom-map tiler and have each project's admin
     grant the tiler's managed identity `Storage Blob Data Reader` on their storage account. What's
     readable is the union of those grants; who can trigger a read is gated by the organization's
     `allows_internal_storage` flag. The `custom-maps` container and the apps managed identity are
     provisioned in `raapid-infra` (`modules/project-capabilities/blob-storage`).

The standalone tiler service lives in its own repo:
[stacnotator-tiler](https://github.com/RAAPID-ORG/stacnotator-tiler) (see its README and
`docs/database.md` for the pgstac bootstrap and keyless GCS signing).
