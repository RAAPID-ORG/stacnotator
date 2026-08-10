# Legacy compatibility shims

Inventory of every place the codebase branches to support old data shapes or
old behavior. The target state is a codebase with no legacy branches: for each
entry, migrate the old data forward (or wait out the deprecation window), then
delete the shim and the tests that pin it.

**Current state: no known legacy shims remain.** The last sweep (2026-08)
audited backend and frontend and retired everything it found; the list below
records what was removed and which migration carries the data forward. New
shims should be added here as numbered entries with: what old thing they
support, where the code lives, a data check, and a removal recipe.

## Retired (2026-08 sweep, branch refactor/remove-legacy-shims)

Code-only removals:

- **Dead WebGL flat-style builder** (`annotationTileStyle.ts`): kept for a
  renderer swap that never landed, with property names that no longer matched
  the backend MVT. Deleted; `TileLabelStyle` moved to its consumer.
- **Magic-wand mock segmentation**: a placeholder that saved fake bbox
  polygons as real annotations. Whole UI surface removed; re-add when a real
  segmentation backend exists.
- **Empty view `source_ids` meant "all sources"** (frontend cycling): pre-
  `source_ids` behavior. Now strict - an empty view selects no sources; the
  duplicated inline cycling logic in `useOpenModeKeyboard.ts` was replaced
  with the shared `imagerySourceCycling.ts` utils.
- **Vestigial optional chaining** on `imagery_views`/`basemaps`/`time_series`,
  which are required fields on `CampaignOutFull`.
- **`seed_dev_data.py`**: still built the pre-views `collection_refs` payload
  (broken import) and swept campaigns by name for pre-tenancy dev DBs.
  Rewritten against the current schemas; seeds a default view per campaign.

Migration-backed removals (each migration normalizes old rows so the code
could go strict):

- **Bare-string label format** - `aa5labelobj` rewrites `{"1": "Forest"}` to
  `{"1": {"name": "Forest"}}`; the four independent decode branches
  (`label_id_to_name`, `convert_labels`, export's `_resolve_label_name`,
  `update_campaign_labels`) now assume the object shape.
- **Labelling-policy default fallback** - `aa6polback` backfills empty
  policies and aborts if any campaign lacks a settings row;
  `get_labelling_policy` is now a bare `model_validate`. The column's server
  default is generated from `default_labelling_policy()` instead of a
  hand-maintained JSON copy.
- **Drifted form-value degradation in export** - `aa7formnorm` drops stored
  form values whose shape no longer matches their field type;
  `_format_form_value` now raises on a mismatch instead of degrading to
  `str(value)`. Drift can no longer be created: `update_campaign_form_fields`
  rejects type/option changes on answered fields.
- **Permissive `RenderConfig` parsing** - `aa8rendfix` repairs continuous
  configs (default colormap/rescale) and deletes empty categorical ones;
  renderability (`build_viz_params`) now runs as a schema validator on
  `RenderConfig` itself, so unrenderable configs never parse and the service
  no longer re-checks.

Behavior change:

- **`counts_toward_completion` None-counted-as-True**: the counting helpers
  (`compute_task_status_value`, export's `_conflicting_task_numbers` and
  merged-row flag) now require the explicitly attached boolean - only True
  counts, and a caller that skips the attach fails loudly (AttributeError /
  KeyError) instead of silently counting. None remains reserved for
  standalone annotations, which never reach task-status computation.

Earlier:

- **Frontend fallback window layout** (`generateFallbackWindowLayout`) -
  removed in `8df100d` when views and layouts became authored in edit mode;
  the backend creates a layout for every view.

## Not shims (checked, no action)

- Standalone annotations reading `counts_toward_completion` back as None is by
  design ("not applicable").
- `Campaign.is_public` (`backend/src/campaigns/models.py`) is a computed
  property over the owning project's `visibility` (org-public deliberately
  does not count). Stored once, on `data.projects`; not a compatibility read.
  The `project.visibility == VISIBILITY_PUBLIC` expression is duplicated in
  four places - a mild smell, not a shim.
- `CORS_ORIGINS` accepting a comma-separated string (`backend/src/config.py`)
  is the live production format - `azure_deploy/deploy-app.sh` and both
  compose files build it comma-separated. The JSON-array path is the
  secondary one, not the legacy one.
- Timeseries `window_name` read-side default (`timeseries/windows.py`
  `strip() or DEFAULT_TIMESERIES_WINDOW_NAME`) is redundant defense: the
  write-path validator and the column's server default guarantee a non-empty
  name. Harmless.
- Stale `source_ids` tolerance when resolving views (`imagery/service.py`,
  `campaigns/duplication.py`): reads drop ids not present in the campaign
  while writes reject them (`_validated_source_ids`). Deliberate referential
  tolerance for JSONB membership, pinned by `test_stale_source_ids_are_ignored`.
- `canvas/layout.py` defensive reads of the `layout_data` JSONB column
  (`or []`, `.get(...)` defaults) are JSON hardening, not versioned-shape
  handling; no old layout shape exists.
- `geometry_type || 'polygon'` in `frontend/.../labelMetadata.ts` covers a
  field that is genuinely nullable in the schema.
- The `'Default'` visualization-name fallback in the campaign wizard
  (`features/campaigns/components/imagery/controller.ts` and `draftSync.ts`)
  handles a source with zero named visualizations in the live wizard draft -
  an editing-state ergonomic, not legacy persisted data.
- The `new-layout` endpoint living on the imagery router is an API-stability
  choice (documented in CLAUDE.md), not a data shim.
- Persisted frontend stores (`preferences.store.ts` `version: 1` with no
  `migrate`; `org.store.ts` and `popout.store.ts` unversioned) are the inverse
  of shims: old localStorage blobs are dropped or rehydrated as-is rather than
  branched on. Known gap, tracked separately from legacy-data shims.
- Alembic migrations that mention legacy schema (`*_drop_legacy_*`,
  `*_retire_*`, `aa4viewsrc`, `aa5labelobj`-`aa8rendfix`) are immutable
  history, not live compat code.
