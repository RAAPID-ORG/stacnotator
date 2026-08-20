# Annotation Vector Tiles

How a campaign's saved annotations get on screen, stay editable, and stay in
step with the other people annotating the same campaign.

An open-mode campaign can hold hundreds of thousands of annotations, and the
workspace draws them on the main map plus every imagery window at once. Sending
that as GeoJSON does not scale, so saved annotations are rendered by Postgres as
vector tiles. Everything the tiles cannot show yet - the shape being edited,
this session's writes, other annotators' work as it arrives - is drawn as a
small feature overlay on top of them. The two halves are what the rest of this
document is about.

Only explore-mode maps draw saved annotations. A task map shows what the page is
pointed at (footprint, crosshair) and nothing else, so none of this runs there.

## The tiles

`GET /api/campaigns/{id}/annotations/tiles/{z}/{x}/{y}.pbf` renders one MVT
straight from PostGIS with `ST_AsMVT` (`backend/src/annotation/router.py`). The
query building and input validation are a DB-free functional core in
`annotation/tiles.py`; `annotation/spatial.py` is the half that executes it.

- **Features carry ids only.** Each feature has `annotation_id` and `label_id`,
  nothing else. The frontend paints by label (label colors, per-user label style
  overrides) and fetches the full record by id when one is opened. Geometry
  detail, comments and form answers never ride in a tile.
- **Below zoom 9 the endpoint returns an empty tile** without touching the
  database (`MIN_TILE_ZOOM`, mirrored by `ANNOTATION_TILE_MIN_ZOOM` in
  `map/compose.ts` - the two are one decision). A continental view of a dense
  campaign would otherwise be a multi-MB, CPU-heavy query.
- **Rows are selected against a margin-expanded tile envelope but clipped to the
  exact one**, so strokes join across tile seams. The spatial filter tests the
  bare geometry column so the GiST index is used; only surviving rows are
  reprojected.
- **Auth is the regular bearer token plus campaign access**, not the
  `tiler_token` cookie the raster tilers use. No external tiler is involved at
  any point.
- **`include_tasks` is spelled out in the URL**, so the filtered and unfiltered
  variants can never share a cache entry. Responses are `private, max-age=3600`.
- Every request takes a slot from the tile bulkhead (`tile_bulkhead.py`) before
  opening a session, so a burst of tile traffic degrades to empty tiles instead
  of starving the API.

On the frontend the layer is an OpenLayers `VectorTileLayer` whose source is
**pooled by URL** (`map/tileLoading.ts`): the main map and a hundred imagery
windows drawing the same annotations make one request per tile between them. Two
lower-resolution levels are preloaded so zooming out lands on tiles that are
already there.

### Version: when tiles are refetched

The tile URL carries `?v=<version>`. Changing it is what fetches the tiles
again, through both the browser cache and OL's; it also drops every loaded tile,
which is why it is not done per write.

The version is the campaign's stored `annotations_version` plus the number of
refreshes this session has asked for. The stored counter is incremented in the
same transaction as every annotation write (`bump_campaign_annotations_version`),
so a page that loads after a change gets fresh tiles. A page that is already open
keeps its tiles and draws the difference itself.

## The delta: what the tiles do not show yet

`campaign/annotationDelta.ts` holds the writes and deletions the tiles do not
carry, as plain data:

- **`pending`** is what has been written since the last refresh, **`settled`**
  the generation the previous refresh covered. Settled entries keep being drawn
  until the refresh after them retires the generation, because the tiles
  carrying those shapes are still on their way.
- The tile layer **hides every id the delta owns** (written or deleted). Nothing
  is drawn twice, and a deleted shape does not linger in a stale tile.
- The overlay draws the delta's shapes with exactly the same label paint, so a
  saved annotation looks the same whether it came from a tile or not. Writes
  picked up from another annotator additionally get a small dot at the shape's
  top right - that is what marks it as new, and it goes when the tiles catch up.
- A **local write always wins the origin**: a shape we drew stays ours when the
  poll hands it back, and one we deleted is not resurrected by a poll that ran
  before the delete landed.

The tiles are refreshed (and the delta rotated) when the delta grows past
`TILE_REFRESH_AFTER` (400 pending writes) - past that the overlay is doing the
tile layer's job - and whenever a write happens whose ids we never learn, such
as a batch label-vector create that reports only a count.

## Editing versus tiles

A tile feature is an id and a label. Everything else about editing follows from
that.

- **Opening one** (click with the pan tool for reading, the edit tool for
  handles) fetches the annotation by id. The record, including its full
  geometry, lives in the edit session in `stores/work.ts`.
- **That one id is hidden in the tiles** and drawn instead by the edit
  interaction on its own sketch layer, with vertex handles (`map/interactions.ts`).
  Exactly one layer draws a given shape at a time, so "who draws it" always has a
  single answer.
- **Saving** writes through the REST API and records the new geometry in the
  delta, which is what draws it until the next tile refresh.
- **Box selection** (Shift+drag with the edit tool) asks
  `GET /annotations/ids?bbox=...` for the ids inside the box: the geometry never
  leaves the server, and the map highlights the returned ids in the tiles it
  already has. Deleting the selection is one request for the whole set.
- **Deleting** records the ids in the delta as deletions, which keeps them hidden
  in the tiles until those are refreshed.
- **A 404 on open** means somebody else deleted it between our last poll and this
  click. The click is how we found out, so it is also where we stop drawing it.
- Who may touch somebody else's annotation is the `modify_others` axis of the
  [labelling policy](labelling-policy.md). An annotation you may not modify still
  opens for reading, just without handles.

## Multiple annotators on one campaign

While an explore-mode campaign is open, the page polls
`GET /api/campaigns/{id}/annotations/changes?since=<cursor>` every 5 seconds
(paused while the tab is hidden; the cursor stays put, so the poll that resumes
covers the whole gap). What comes back is merged into the same delta as local
writes, so nobody has to refetch tiles to see anyone else's work.

- **Creates and edits** arrive as rows (id, label, geometry, author) whose
  `updated_at` is at or after the cursor. **Deletions** arrive as ids from the
  `deleted_annotations` tombstone table, written in the same transaction as the
  delete - a deletion is the one change that leaves no row to read.
- **The cursor is the database clock** (`SELECT now()`, taken at the start of the
  polling transaction), never the client's. Each poll re-reads a few seconds
  further back than asked (`CHANGES_OVERLAP`), because rows are stamped when
  their transaction runs and not when it commits: a poll landing between the two
  would otherwise miss that row for good. Ids are what the client merges on, so
  seeing one twice is free.
- **Two ways a poll gives up and says "refetch your tiles"**: more than
  `CHANGES_LIMIT` (500) changes are waiting, which is more than an overlay should
  carry; or the cursor is older than `DELETION_RETENTION` (7 days), past which
  what was deleted in between cannot be named any more.
- **Conflicts are not merged.** There is no locking and no per-field
  reconciliation: the later save is what is stored, and the other annotator's map
  picks it up on the next poll. At a 5 second interval two people working the
  same area see each other well before they collide.

The poll is deliberately cheap rather than real-time: a poll that finds nothing
is two index seeks, and the auth and campaign-access checks around it cost more
than the query does. See the note on `REMOTE_POLL_MS` in `stores/work.ts` for how
the interval is sized against the deployment.

## Custom vector layers are not this

Campaign overlay layers (`custom_layers`) are static PMTiles files read straight
from blob storage by range request, with neither the backend nor a tiler in the
request path. They are reference data, not annotations: nothing versions or polls
them. The label-vector tool (`B`) turns clicked or box-selected features from
such a layer into real annotations, which then live in the tiles described above.
