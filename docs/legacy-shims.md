# Legacy compatibility shims

Inventory of every place the codebase still branches to support old data shapes or old
behavior. The target state is a codebase with no legacy branches: for each entry, migrate
the old data forward (or wait out the deprecation window), then delete the shim and the
tests that pin it. Ordered roughly by how easy they are to retire.

Each entry lists: what old thing it supports, where the code lives, how to check whether
the legacy case still occurs in real data, and how to remove it.

## 1. `is_authorative_reviewer` wire-name typo

- **Supports:** API stability. The field is spelled correctly in Python
  (`is_authoritative_reviewer`) but serialized under the historical typo so the generated
  frontend client keeps working.
- **Code:** `backend/src/campaigns/schemas.py` (`CampaignUserOut`,
  `serialization_alias="is_authorative_reviewer"`).
- **Consumers:** generated client (`frontend/src/api/client/types.gen.ts`) plus
  `campaign.store.ts`, `StepCampaign.tsx`, `CampaignUsersSection.tsx`,
  `TaskAssignmentModal.tsx`, `ReviewerAssignmentModal.tsx`.
- **Data check:** none needed, no stored data involved.
- **Removal:** one coordinated PR. Drop the alias, regenerate the client
  (`make dev-openapi`), rename the field in the five frontend files. Breaks any external
  API consumer relying on the typo, so mention it in the release notes.

## 2. Legacy bare-string label format

- **Supports:** `campaign_settings.labels` rows written before labels became objects.
  Old shape `{"1": "Forest"}`, new shape
  `{"1": {"name": "Forest", "geometry_type": "polygon"}}`.
- **Code:** `backend/src/campaigns/schemas.py` (`convert_labels` validator, the
  `isinstance(vv, dict)` else-branch).
- **Data check:**
  ```sql
  SELECT s.campaign_id, e.key, e.value
  FROM data.campaign_settings s, jsonb_each(s.labels) e
  WHERE jsonb_typeof(e.value) <> 'object';
  ```
- **Removal:** author a data migration that rewrites string values to
  `{"name": <value>, "geometry_type": null}`, then delete the else-branch so a non-dict
  value fails loudly. No dedicated test pins the legacy branch.

## 3. Labelling-policy default fallback

- **Supports:** campaigns whose settings predate the `labelling_policy` column.
- **Code:** `backend/src/campaigns/service.py` (`get_labelling_policy`).
- **Pinned by:** `backend/tests/unit/test_labelling_policy.py` ("legacy campaign" case),
  `backend/tests/unit/test_labelling_policy_enforcement.py`.
- **Note:** the column is now `nullable=False` with a full server default
  (`backend/src/campaigns/models.py`), so every settings row has a policy. The fallback
  can only fire when `campaign.settings` is None entirely.
- **Data check:**
  ```sql
  SELECT c.id FROM data.campaigns c
  LEFT JOIN data.campaign_settings s ON s.campaign_id = c.id
  WHERE s.campaign_id IS NULL;
  ```
- **Removal:** if the query is empty (and campaign creation always writes settings),
  reduce the function to `LabellingPolicy.model_validate(campaign.settings.labelling_policy)`
  and delete the fallback tests. If any campaign lacks a settings row, backfill one first.

## 4. Frontend fallback window layout for campaigns without stored view layouts

- **Supports:** campaigns created before view layouts were persisted server-side; the
  frontend generates a default grid on the fly.
- **Code:** `frontend/src/features/annotation/stores/campaign.store.ts`
  (`generateFallbackWindowLayout`, the `if (view)` branch in `buildMergedLayout`).
- **Data check:** views with no default canvas layout row:
  ```sql
  SELECT v.id FROM data.imagery_views v
  LEFT JOIN data.canvas_layouts l
    ON l.view_id = v.id AND l.is_default = true
  WHERE l.id IS NULL;
  ```
- **Removal:** author a backfill migration that inserts a default `canvas_layouts` row per
  layout-less view (reuse the layout logic in `backend/src/canvas/layout.py` rather than
  porting the frontend grid math). Then delete `generateFallbackWindowLayout` and the
  fallback branch so `buildMergedLayout` trusts the stored layout.

## 5. Permissive `RenderConfig` parsing for custom maps

- **Supports:** custom-map rows written before the service-level renderability check
  existed. Renderability is deliberately not enforced in the schema because `RenderConfig`
  also types `CustomMapOut`: a schema validator would make old unrenderable rows unreadable
  and 500 the whole campaign GET.
- **Code:** `backend/src/custom_layers/schemas.py` (`RenderConfig`), enforcement lives in
  the service.
- **Pinned by:** `backend/tests/unit/test_custom_map_schemas.py`
  (`test_unrenderable_config_still_parses_so_legacy_rows_stay_readable`).
- **Data check:** select rows failing the same conditions the service checks, e.g.
  continuous mode without `colormap_name`:
  ```sql
  SELECT id, name, render_config FROM data.custom_maps
  WHERE (render_config->>'mode' = 'continuous' AND render_config->>'colormap_name' IS NULL)
     OR (render_config->>'mode' = 'categorical' AND jsonb_array_length(coalesce(render_config->'entries', '[]')) = 0);
  ```
- **Removal:** fix or delete any offending rows, then move the renderability validation
  onto the input schema (`CustomMapCreate`/update). Keeping `CustomMapOut` permissive is
  still reasonable defense-in-depth; the decision point is whether reads should ever trust
  the DB less than writes. Either way the "legacy rows" justification disappears.

## 6. Old `?tab=` deep-link redirects on the settings page

- **Supports:** external bookmarks to `?tab=tasks` (task management moved to its own page)
  and `?tab=annotations` (bulk import moved to the Annotations page). No internal link
  generates these params anymore (verified by grep).
- **Code:** `frontend/src/features/campaigns/pages/CampaignSettingsPage.tsx` (the
  `tabParam` redirect effect).
- **Data check:** none possible, the "data" is users' bookmarks.
- **Removal:** time-based. Delete the effect after a deprecation window (suggested: one or
  two releases after the pages moved). Landing on settings without a redirect is a mild
  degradation, not a break.

## 7. `counts_toward_completion` tri-state (None counts as True)

- **Supports:** two things at once, only one of which is legacy.
  None means "not applicable" for standalone annotations (deliberate, see
  `attach_counts_toward_completion_flat` in `backend/src/annotation/service.py`), but the
  counting helpers treat None as counting so that callers which never attach the flag keep
  pre-labelling-policy behavior.
- **Code:** `backend/src/annotation/io.py` (`_conflicting_task_numbers`, export records),
  `backend/src/annotation/schemas.py` (`is not False` checks).
- **Pinned by:** `backend/tests/unit/test_annotation_io_export.py`
  (`test_missing_flag_defaults_to_counting`).
- **Removal:** requires a decision, not a data migration. The clean end state is: every
  task-linked read path attaches the flag before the counting helpers run, so the helpers
  can require an explicit boolean and None is reserved for standalone annotations. Audit
  callers of `_conflicting_task_numbers` / `compute_task_status_value` first; if all
  already attach, tighten the checks and repurpose the test to assert the strict behavior.

## Not shims (checked, no action)

- Standalone annotations reading `counts_toward_completion` back as None is by design
  ("not applicable"), only the unset-means-counts half of entry 7 is legacy.
- The guided-tour localStorage migration in `preferences.store.ts` was already removed;
  a stale comment claiming otherwise was cleaned up alongside this doc.
- Alembic migrations that mention legacy schema (`*_drop_legacy_*`, `*_retire_*`) are
  immutable history, not live compat code.
