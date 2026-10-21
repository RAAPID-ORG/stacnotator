# Lessons

## Keep catalog scope small

Catalogs belong to projects only, under project Settings. Do not reintroduce
organization ownership or creator-specific permission rules without a new request.

For this unreleased feature, edit the original migration as requested rather than
adding a compatibility migration. Check local development data before refreshing
an already-applied revision.

Keep catalog controls compact and avoid asking for metadata the raster already
contains. Detect bands during indexing, then show the actual bands for optional
renaming. UI-only refinements do not need new specification suites.
