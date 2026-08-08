# Legacy compatibility shims

Inventory of every place the codebase still branches to support old data shapes or old
behavior. The target state is a codebase with no legacy branches: for each entry, migrate
the old data forward (or wait out the deprecation window), then delete the shim and the
tests that pin it. Ordered roughly by how easy they are to retire: code-only deletions
first, then removals that need a data migration, then the one that needs a behavior
change.

Each entry lists: what old thing it supports, where the code lives, how to check whether
the legacy case still occurs in real data, and how to remove it.

## Code-only removals (no migration needed)

### 1. Dead WebGL flat-style builder with stale property names

- **Supports:** a future WebGL renderer swap that never landed. The builder reads
  camelCase feature properties (`labelId`, `annotationId`) but the backend MVT emits
  snake_case (`backend/src/annotation/tiles.py`: `annotation_id`, `label_id`), so
  swapping it in today would paint every feature the fallback gray.
- **Code:** `frontend/src/features/annotation/utils/annotationTileStyle.ts`
  (`buildAnnotationTileFlatStyle`, `EDITING_ID_VAR`, `NO_EDITING_ID`). Production only
  imports the `TileLabelStyle` type; the builder is imported solely by its own test.
  A comment in `useAnnotationTileLayer.ts` claims the builder is "ready for that swap" -
  it is not.
- **Pinned by:** `annotationTileStyle.test.ts`, which asserts the wrong property names.
- **Removal:** move `TileLabelStyle` next to its consumers, delete the builder, its
  vars, and the test; correct the comment in `useAnnotationTileLayer.ts`. Rebuild the
  flat style against the real tile properties when the WebGL path actually lands.

### 2. Magic-wand mock segmentation shipped as a live feature

- **Supports:** nothing old - it is a placeholder that outlived its "for now". A click
  saves a fake bounding-box polygon as a real annotation.
- **Code:** `frontend/src/shared/utils/utility.ts` (`mockMagicWandSegmentation`), wired
  through `DrawingLayer.tsx`, `task.store.ts` (magic-wand state), `ControlsOpenMode.tsx`
  (tool button), `MainAnnotationContainer.tsx`.
- **Pinned by:** nothing - no vitest or e2e coverage.
- **Removal:** delete the mock and the whole magic-wand UI surface (button, store state,
  DrawingLayer branch). Re-add the tool when a real segmentation backend exists.

### 3. Empty view `source_ids` means "all sources" (frontend)

- **Supports:** pre-`source_ids` behavior where views did not constrain imagery. After
  the `aa4viewsrc` migration every existing view got its sources backfilled, so an empty
  set now only arises when an admin authors a view with no sources - a legitimate state
  that this fallback silently turns into "cycle every campaign source". The same file
  already treats membership strictly elsewhere (`computeCycleSource` gives non-member
  sources zero browsable collections), so an empty view today cycles all sources but can
  browse none - internally inconsistent.
- **Code:** `frontend/src/features/annotation/utils/imagerySourceCycling.ts`
  (`buildSourceGroups`, the `viewSourceIds.size > 0 &&` guard), plus a hand-rolled inline
  copy of both `buildSourceGroups` and `computeCycleSource` in
  `frontend/src/features/annotation/hooks/useOpenModeKeyboard.ts` (untested).
- **Pinned by:** `imagerySourceCycling.test.ts`
  (`includes all sources when viewSourceIds is empty`).
- **Removal:** drop the `size > 0` guard so empty means "no sources", flip the pinning
  test to assert the strict behavior, and replace the inline copies in
  `useOpenModeKeyboard.ts` with calls to the shared utils so the rule lives in one place.

### 4. Vestigial optional chaining on always-present campaign fields

- **Supports:** API responses from before `imagery_views`, `basemaps`, and `time_series`
  were always present. All three are non-optional on `CampaignOutFull` in the generated
  types, yet several call sites still guard them while others correctly do not.
- **Code:** guarded sites include `components/Canvas.tsx`, `TimelineSidebar.tsx`,
  `MainAnnotationContainer.tsx`, `Map/useSliceLayers.ts`, `hooks/useOpenModeKeyboard.ts`
  (`campaign?.imagery_views?.`, `campaign.time_series?.length ?? 0`,
  `campaign.basemaps ?? []`). Compare the unguarded style in `useSliceNavigation.ts`,
  `task.store.ts`, `campaign.store.ts`. Note `custom_maps` and `vector_layers` ARE
  optional in the schema - `?? []` on those is genuine and stays.
- **Pinned by:** nothing.
- **Removal:** drop the optional chaining on the three required fields;
  `tsc --noEmit` keeps it honest.

### 5. `seed_dev_data.py` stale from the views transition (broken) + by-name cleanup

- **Supports:** two things. (a) The seed script still imports `ViewCollectionRefCreate`
  and builds `collection_refs` / old `CollectionStacConfigCreate` fields - symbols that
  no longer exist, so the module fails at import. This is the only `collection_refs`
  reference left outside `backend/alembic/`. (b) `clear_dev_data` sweeps campaigns by
  name in addition to the "Dev Org" cascade, purely for dev DBs seeded before
  org/project tenancy.
- **Code:** `backend/seed_dev_data.py` (imports, the `views=[...]` block,
  `clear_dev_data`).
- **Pinned by:** nothing.
- **Removal:** rewrite the seed against the current schemas (`ImageryViewCreate` with
  `source_ids`, `catalog_url`/`search_query`); delete the by-name sweep - anyone with a
  pre-tenancy dev DB runs `make dev-reset` once.

## Migration-backed removals

### 6. Legacy bare-string label format (four sites)

- **Supports:** `campaign_settings.labels` rows written before labels became objects.
  Old shape `{"1": "Forest"}`, new shape
  `{"1": {"name": "Forest", "geometry_type": "polygon"}}`.
- **Code:** the old shape is decoded independently in four places:
  - `backend/src/campaigns/schemas.py` `label_id_to_name`
    (`... if isinstance(data, dict) else str(data)`), also called from
    `campaigns/statistics.py` and `campaigns/assignments.py`
  - `backend/src/campaigns/schemas.py` `convert_labels` validator
    (`vv.get("geometry_type") if isinstance(vv, dict) else None`)
  - `backend/src/annotation/export.py` `_resolve_label_name` (independent copy)
  - `backend/src/campaigns/service.py` `update_campaign_labels`
    (`existing_entry.get("geometry_type") if isinstance(existing_entry, dict) else None` -
    a string-shaped label silently skips the geometry-type-change 409 guard)
- **Pinned by:** nothing - no test exercises the string branch.
- **Data check:**
  ```sql
  SELECT s.campaign_id, e.key, e.value
  FROM data.campaign_settings s, jsonb_each(s.labels) e
  WHERE jsonb_typeof(e.value) <> 'object';
  ```
- **Removal:** author a data migration that rewrites string values to
  `{"name": <value>}`, then delete the `isinstance` branches at all four sites so a
  non-dict value fails loudly. The write path (`to_orm`) already only emits objects.

### 7. Labelling-policy default fallback

- **Supports:** campaigns whose settings predate the `labelling_policy` column, or that
  have no settings row at all.
- **Code:** `backend/src/campaigns/policy.py` `get_labelling_policy` (moved here from
  `service.py`). The fallback is two-pronged: fires when `campaign.settings` is None
  *or* when `labelling_policy` is falsy (e.g. `{}`).
- **Pinned by:** `backend/tests/unit/test_labelling_policy.py`
  (`test_get_labelling_policy_returns_default_when_settings_missing`,
  `test_get_labelling_policy_returns_default_when_column_empty`).
- **Note:** the column is `nullable=False` with a full JSONB `server_default`
  (`backend/src/campaigns/models.py`), so every persisted settings row has a policy.
  That server default is a hardcoded copy of `default_labelling_policy()` - a third
  statement of the same default, worth collapsing while here.
- **Data check:**
  ```sql
  SELECT c.id FROM data.campaigns c
  LEFT JOIN data.campaign_settings s ON s.campaign_id = c.id
  WHERE s.campaign_id IS NULL;
  -- and
  SELECT campaign_id FROM data.campaign_settings
  WHERE labelling_policy IS NULL OR labelling_policy = '{}'::jsonb;
  ```
- **Removal:** author a migration that backfills a default settings row for any
  settings-less campaign and normalizes empty policies, then reduce the function to
  `LabellingPolicy.model_validate(campaign.settings.labelling_policy)` and delete the
  two fallback tests.

### 8. Drifted form-value degradation in export

- **Supports:** form answers stored before `update_campaign_form_fields` started
  rejecting type/option changes on fields that already have answers. Any value whose
  shape no longer matches its field type degrades to `str(value)` so exports never
  crash.
- **Code:** `backend/src/annotation/export.py` `_format_form_value` (the `str(value)`
  fall-throughs for category/multicategory/daterange).
- **Pinned by:** `backend/tests/unit/test_annotation_io_forms.py`
  (`test_category_with_non_int_value_falls_back_to_str` and siblings).
- **Data check:** per campaign, compare stored answer shapes against the current field
  definitions, e.g. category values that are not integers:
  ```sql
  SELECT a.id, a.form_values FROM data.annotations a
  WHERE a.form_values IS NOT NULL;  -- shape-check in a script against field types
  ```
- **Removal:** the API guard means drift can no longer be created; migrate or null any
  drifted values found, then make `_format_form_value` strict (raise or skip) and
  repurpose the degradation tests to assert strictness.

### 9. Permissive `RenderConfig` parsing for custom maps

- **Supports:** custom-map rows written before the service-level renderability check
  existed. Renderability is deliberately not enforced in the schema because
  `RenderConfig` also types `CustomMapOut`: a schema validator would make old
  unrenderable rows unreadable and 500 the whole campaign GET.
- **Code:** `backend/src/custom_layers/schemas.py` (`RenderConfig`); enforcement lives
  in `custom_layers/service.py` `_render_config_dict`.
- **Pinned by:** `backend/tests/unit/test_custom_map_schemas.py`
  (`test_unrenderable_config_still_parses_so_legacy_rows_stay_readable`);
  `backend/tests/test_custom_map_service.py`
  (`test_unrenderable_render_config_is_rejected_on_create_and_update`).
- **Data check:**
  ```sql
  SELECT id, name, render_config FROM data.custom_maps
  WHERE (render_config->>'mode' = 'continuous' AND render_config->>'colormap_name' IS NULL)
     OR (render_config->>'mode' = 'categorical' AND jsonb_array_length(coalesce(render_config->'entries', '[]')) = 0);
  ```
- **Removal:** author a migration that fixes or deletes offending rows, then move the
  renderability validation onto the input schema (`CustomMapCreate`/update). Keeping
  `CustomMapOut` permissive stays reasonable defense-in-depth; the "legacy rows"
  justification disappears either way.

## Behavior-change removal

### 10. `counts_toward_completion` tri-state (None counts as True)

- **Supports:** two things at once, only one of which is legacy. None means "not
  applicable" for standalone annotations (deliberate, see
  `attach_counts_toward_completion_flat` in `backend/src/annotation/completion.py`),
  but the counting helpers treat None as counting so that callers which never attach
  the flag keep pre-labelling-policy behavior. No data migration - the flag is
  computed per request, never stored.
- **Code:** after the `annotation/io.py` module split:
  - `backend/src/annotation/export.py` `_conflicting_task_numbers`
    (`... is not False`) and the per-annotation export records
  - `backend/src/annotation/export.py` merged-row export - note it uses
    `getattr(a, "counts_toward_completion", False)`, defaulting to **False**, the
    opposite of the other two sites; a genuine inconsistency
  - `backend/src/annotation/schemas.py` (`is not False` check, tri-state contract
    documented inline)
  - attach helpers in `backend/src/annotation/completion.py`, called from
    `annotation/service.py` and `export.py`
- **Pinned by:** `backend/tests/unit/test_annotation_io_export.py`
  (`test_missing_flag_defaults_to_counting`).
- **Removal:** audit callers of `_conflicting_task_numbers` / `compute_task_status_value`; ensure
  every task-linked read path attaches the flag before the counting helpers run, then
  require an explicit boolean in the helpers (None reserved for standalone
  annotations), resolve the False-default inconsistency in the merged-row export, and
  repurpose the pinning test to assert the strict behavior.

## Removal plan

Order of work; each step is independently shippable.

1. **Code-only sweep (entries 1-5):** delete the WebGL builder, the magic-wand
   feature, the empty-view fallback (+ dedupe the inline copies in
   `useOpenModeKeyboard.ts`), the vestigial optional chaining, and fix the seed
   script. No migrations, no data checks; frontend unit tests updated in the same
   commits.
2. **Label-format migration (entry 6):** one data migration normalizing string labels,
   then delete all four `isinstance` branches.
3. **Settings backfill migration (entry 7):** backfill settings rows / normalize empty
   policies, collapse `get_labelling_policy` to a one-liner, drop the two fallback
   tests, and deduplicate the hardcoded server-default JSON against
   `default_labelling_policy()`.
4. **Form-value strictness (entry 8):** run the drift check, migrate anything found,
   make export formatting strict.
5. **RenderConfig input validation (entry 9):** fix/delete offending rows by
   migration, enforce renderability on the input schemas.
6. **Tri-state tightening (entry 10):** audit attach coverage, then require explicit
   booleans in the counting helpers.

Migrations are authored in the branch but never applied to shared databases from a dev
machine; they run through the normal deploy pipeline.

## Retired

- Frontend fallback window layout for campaigns without stored view layouts
  (`generateFallbackWindowLayout`) - removed in `8df100d` when views and layouts became
  authored in edit mode; the backend now creates a layout for every view.

## Not shims (checked, no action)

- Standalone annotations reading `counts_toward_completion` back as None is by design
  ("not applicable"); only the unset-means-counts half of entry 10 is legacy.
- The `'Default'` visualization-name fallback in the campaign wizard
  (`features/campaigns/components/imagery/controller.ts` and `draftSync.ts`) handles a
  source with zero named visualizations in the live wizard draft - an editing-state
  ergonomic, not legacy persisted data. Persisted sources get their visualization
  names validated on create.
- `Campaign.is_public` (`backend/src/campaigns/models.py`) is a computed property over
  the owning project's `visibility` (org-public deliberately does not count). Stored
  once, on `data.projects`; not a compatibility read. The
  `project.visibility == VISIBILITY_PUBLIC` expression is duplicated in four places -
  a mild smell, not a shim.
- `CORS_ORIGINS` accepting a comma-separated string (`backend/src/config.py`) is the
  live production format - `azure_deploy/deploy-app.sh` and both compose files build
  it comma-separated. The JSON-array path is the secondary one, not the legacy one.
- Timeseries `window_name` read-side default (`timeseries/windows.py`
  `strip() or DEFAULT_TIMESERIES_WINDOW_NAME`) is redundant defense: the write-path
  validator and the column's server default guarantee a non-empty name. Harmless.
- Stale `source_ids` tolerance when resolving views (`imagery/service.py`,
  `campaigns/duplication.py`): reads drop ids not present in the campaign while writes
  reject them (`_validated_source_ids`). Deliberate referential tolerance for JSONB
  membership, pinned by `test_stale_source_ids_are_ignored`.
- `canvas/layout.py` defensive reads of the `layout_data` JSONB column (`or []`,
  `.get(...)` defaults) are JSON hardening, not versioned-shape handling; no old
  layout shape exists.
- `geometry_type || 'polygon'` in `frontend/.../labelMetadata.ts` covers a field that
  is genuinely nullable in the schema.
- The `new-layout` endpoint living on the imagery router is an API-stability choice
  (documented in CLAUDE.md), not a data shim.
- Persisted frontend stores (`preferences.store.ts` `version: 1` with no `migrate`;
  `org.store.ts` and `popout.store.ts` unversioned) are the inverse of shims: old
  localStorage blobs are dropped or rehydrated as-is rather than branched on. Known
  gap, tracked separately from legacy-data shims.
- Alembic migrations that mention legacy schema (`*_drop_legacy_*`, `*_retire_*`,
  `aa4viewsrc`) are immutable history, not live compat code.
