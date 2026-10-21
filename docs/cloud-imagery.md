# Azure cloud imagery catalogs

Cloud catalogs turn selected Azure Blob GeoTIFFs into reusable STAC collections.
The source imagery stays in Azure; indexing is not a backup.

## Setup

Use a hosted tiler built with the managed-catalog endpoints. Set
`ALLOW_MANAGED_CATALOGS=true` on that tiler only when **no public STAC API exposes
the same pgstac database**. The tiler defaults this feature off. Its updated
standalone Compose setup no longer starts the public STAC service. The core
development stack's optional tiler enables managed catalogs and has no public
STAC service.

Configure the tiler in `TILERS`, then allow it for the organization. An old or
disabled tiler fails the import capability check; `allows_ingest` alone is not
proof of managed-catalog support. Apply backend migrations through `bt1cloudcat`
and regenerate/rebuild the frontend when deploying these changes.

## Indexing and reuse

Open **Settings > Imagery catalogs** in a project. Catalogs belong to that project;
organization-wide catalogs are not supported. Existing project `/catalogs` links
redirect to Settings. The imagery wizard's **Manage** button opens this section
in the same tab and scrolls to it.

1. Create a catalog with its title, Azure container URL, optional path prefix,
   hosted tiler, and a container SAS granting read and list access.
2. Discovered files start selected. Use **Select all / Unselect all** for files
   listed so far. Enter a date per file; check **Interval** beside it for start/end
   dates. Alternatively, expand **Extract dates from filenames (optional)** above
   the list; the question mark shows an example. Check **Auto-select matching
   entries only** and click **Apply** to select matching paths and unselect the
   rest. CSV date import is also available below the list.
3. Choose **Index selected**. The page shows progress and file-specific failures;
   navigation away does not stop indexing. Reopen the catalog to see its run.
4. Once ready, open **Custom (other)** in the campaign imagery wizard and select
   the catalog under **No - I have my own imagery in cloud storage**.

One file is one item by default. To combine related files, expand **Group files
into items (optional)** and either select files then **Group selected as one item**,
or add asset-name/file-pattern rules, check the preview, and choose **Apply grouping**. For example,
`reflectance` with `_reflectance\.tif$` and `clear-count` with `_clear-count\.tif$`
produce two assets per monthly item when the paths contain `2025-01`, `2025-02`,
and so on. Month-only dates become full-month intervals. Each group has one shared
date control; **Ungroup** returns its files to separate items. Only matching selected
files are grouped; unmatched files keep their selection, dates and grouping. They
still need dates if selected for indexing. Not every rule needs a match on every
date. Conflicting rules,
duplicate asset names within an item, and mismatched dates are rejected.

Raster headers automatically supply band counts, names and types during indexing.
**Catalog settings** shows detected counts and names once indexing finishes.
Missing names fall back to numbered bands. A file's **Edit asset > Rename bands
(optional)** accepts comma-separated overrides; the count must match the raster.
Indexing stores `eo:bands` and
`raster:bands` on each STAC asset. Visualization editors use the recorded asset and
band names rather than asking for a band count. An older catalog without that
metadata retains the manual band-count field.

There is no inspection/review approval step. Metadata is read during indexing.
Unreadable files, missing georeferencing, invalid times, changed objects and
failed batches prevent publication; files are not silently skipped.

Open a catalog and choose **Delete catalog** to remove it, including a draft.
Original files in cloud storage are not deleted. Catalogs used by campaign imagery
or with indexing running cannot be deleted.

Date-only instants mean midnight UTC. Date-only interval bounds cover whole UTC
days, with the end at `23:59:59.999999Z`. Interval searches use overlap.

Catalogs are reusable only within their project, including when other projects
belong to the same organization. Project administrators and platform administrators
manage catalogs. Organization administration alone grants no catalog access.

Visualization settings use the existing imagery editor. A campaign receives a
copy of the selected catalog presets; later catalog edits do not update existing
campaigns. Data region is optional supplied metadata; tiler region comes from
operator configuration. Unknown values are shown as unknown.

## Execution and limits

The backend uses the existing registration-thread/status/heartbeat mechanism,
not a separate worker service. Admission is bounded across web processes by
`CLOUD_IMPORT_MAX_CONCURRENT` (default 2). `CLOUD_IMPORT_BATCH_SIZE` defaults to
50 and is further limited by the tiler's capability response. An item's assets
stay in one batch, even if the group exceeds the preferred size; the tiler's hard
asset limit still applies. At capacity, new indexing jobs receive a clear error
rather than joining an unbounded queue.

Database transactions are released before external reads. Completed batches
are checkpointed, stale workers cannot publish completion, and failed imports
can explicitly retry. A replacement manifest uses a new tiler collection ID so
late writes to an old collection cannot change the replacement dataset.

Only complete, verified, nonempty imports become reusable. This is not a
full-pixel corruption scan; later source deletion or access expiry can still
make imagery unreadable.

Current restrictions:
- Azure Blob container SAS only; S3-compatible storage is not implemented.
- A used catalog cannot be deleted or have its SAS replaced. Unbind its campaign
  imagery before changing the credential. Automatic dependent-search rotation
  is not implemented.
- Customer-private catalogs cannot be published through visualizers.
- Metadata left by a replaced failed import may require operator cleanup after
  a restart or a very late remote batch. It is not attached to the replacement
  catalog. See the implementation backlog for the outstanding cleanup lifecycle.

## Verification

Automated coverage uses real PostgreSQL, real local raster metadata reads,
provider fakes, and browser interaction. A separate real pgstac check covers
load, verification, interval queries and deletion. A live Azure SAS/container
walkthrough remains necessary before enabling this for users; no customer
credentials or paid cloud resources are supplied by the tests.
