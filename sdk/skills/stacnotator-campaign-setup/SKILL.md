---
name: stacnotator-campaign-setup
description: Set up a new STACNotator campaign or change an existing one through the stacnotator MCP server - area (looked up in geoBoundaries), period, labels, guide, satellite imagery, basemaps, time series and tasks - agreed with the user as one proposal, then preview it. Use when asked to create, set up, prepare or change a STACNotator campaign or its imagery.
---

# Setting up a STACNotator campaign

First ask the user for the full URL of the STACNotator to use (`https://...`), every session,
even if you used one before; never assume or complete one. Then `login(url)`.

**Only the tools you were given.** `create_campaign`, `add_tasks`, `edit_campaign` and
`edit_imagery` are there only when the user granted them (`STACNOTATOR_MCP_ALLOW`). When one
you need is missing, tell the user which one and stop. Never make the change another way,
such as through the SDK, the API or the app.

**The user decides, you propose.** Never invent the area, the period, the labels or the
tasks, even when the request names them only loosely ("corn in Iowa"). Ask, propose, and
create or change nothing until the user has explicitly accepted the complete proposal in
the chat.

## Steps

1. `list_projects()`: the campaign goes in a project where `is_admin` is true. Ask which one
   when the user did not say.
2. **Pin down where.** Ask which area, as an administrative unit or an exact box. For a
   unit, look it up with `find_area(country, name, level?, within?)` (geoBoundaries, one
   country and level at a time) and show the user the matches: name, level, bbox and
   boundary year. The campaign's area is the `bbox` of the unit they pick; keep its
   `area_id` for sampling tasks inside its outline. Any other box comes only from the
   user. Keep the area to what they care about: a state is fine to sample tasks in, but every task
   needs imagery, so ask before going larger than a few counties or districts.
3. **Pin down when.** Ask for the year or years and the season. When the user does not
   know the dates that tell the labels apart, propose them from the crop calendar or the
   years of the change, say why, and let them confirm.
4. **Pin down what.** Ask for the labels and what each means, how tasks are made (how
   many, sampled randomly or on a grid, inside the unit's outline or the whole box, or
   the user's own points), and whether they want time series.
5. `setup_options(project_id)`: imagery collections with their visualizations, basemaps,
   and time series sources and types. A `render_browser` note: ask the user before
   `install_render_browsers`.
6. **Put the full proposal to the user** in one message and ask them to accept it or say
   what to change:
   - name and project
   - area: the unit (name, level, source and year) or the box
   - labels, task output and label geometry
   - every imagery source: collection, visualizations, max cloud cover, and each window
     with its slices and cover, as dates
   - basemaps, time series (source, index, months)
   - the guide, in full
   - tasks: task set name, count and how they are placed
   Revise until they explicitly accept. Silence or "looks interesting" is not acceptance.
7. `create_campaign(...)` with the `bbox` and exactly the accepted values. It
   returns `campaign_id`, `url` and the task sets.
8. `add_tasks(campaign_id, task_set, ...)` as accepted, with exactly one of `geojson`
   (a FeatureCollection; the user's points become Point features) or `sampling`
   (`{"strategy_type": "random", "num_samples": 100, "seed": 1, "area_id": "..."}` or
   `{"strategy_type": "grid", "spacing_km": 5}`). With an
   `area_id`, tasks fall inside the unit's outline; without one, anywhere in the box.
9. `get_campaign(campaign_id)` about every 30 seconds until `registration_status` is
   `ready`. On `failed`, report `registration_errors` to the user.
10. `preview_campaign(campaign_id, max_image_edge_px, max_image_megapixels)`: check that
    the imagery shows what the labels need (cloud-free dates, a zoom where the classes
    differ). If it does not, propose a change (see below).
11. Give the user the campaign `url`. To label it with agents, use the labelling skill.

Anything the user wants different afterwards, or anything you would add that was not in
the accepted proposal (another task set, another source), is a new proposal: put it to
them and wait for acceptance again.

## Changing an existing campaign

1. `get_campaign(campaign_id)`: its settings (labels with their ids), imagery sources with
   their windows and slices, basemaps, time series and task sets.
2. Propose the change as a before and after, and wait for acceptance.
3. Settings: `edit_campaign(campaign_id, settings)` with only what changes. `labels` is the full
   list: keep each existing label's id (renaming keeps it), give new ones the next free ids,
   and never drop one.
4. Imagery: `edit_imagery(campaign_id, imagery?, remove?, basemaps?)`. A recipe named like a
   stored source replaces it; any other recipe is added; `remove` deletes sources by name;
   sources you do not name stay as they are. Changed imagery registers again, so follow
   with steps 9 and 10.

## Choosing imagery

| need | collection |
| --- | --- |
| crops or land cover over a season | `sentinel-2-l2a` (10 m) |
| change over many years (30 m) | `landsat-c2-l2` |
| seeing through clouds, flooding | `sentinel-1-grd` (radar) |
| sub-metre detail, US only | `naip` |
| terrain | `cop-dem-glo-30` |

A recipe spells out every date the labellers get, so pick them from what tells the labels
apart (the crop calendar, the years of a change), not a regular grid:

```json
{"collection": "sentinel-2-l2a", "visualizations": ["True Color (RGB)", "NDVI"],
 "windows": [
   {"name": "2021",
    "slices": [{"start": "2021-05-01", "end": "2021-05-31", "name": "May"},
               {"start": "2021-07-01", "end": "2021-07-31", "name": "Jul"},
               {"start": "2021-09-01", "end": "2021-09-30", "name": "Sep"}],
    "cover": 1}
 ]}
```

Each window becomes a collection whose slices labellers step through. Its `cover` stands
for the window: the index of the most telling slice, or `{"start", "end"}` for a dedicated
composite of the window's least cloudy images. A labelling agent's first look shows the
covers of the first source's windows side by side (up to four, spread over them), so make
the dates the labels are told apart by the covers of separate windows: one window per year
for change over years, one per month or growth stage within a season. Dates are
`YYYY-MM-DD`, both ends included. A slice of a month or more gives a cloud-free mosaic; a
week shows one date but is often cloudy.

Write the guide for both people and agents: what each label means, what it looks like in
the imagery and time series, and what to do when unsure.
