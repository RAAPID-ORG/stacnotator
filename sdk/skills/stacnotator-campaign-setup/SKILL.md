---
name: stacnotator-campaign-setup
description: Set up a new STACNotator campaign or change an existing one through the stacnotator MCP server - area, period, labels, guide, satellite imagery, basemaps, time series and tasks - agreed with the user as one proposal, then preview it. Use when asked to create, set up, prepare or change a STACNotator campaign or its imagery.
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
2. **Pin down where, when and what.** Ask for the area as a box (west, south, east, north),
   or name the place and propose a box for them to confirm; keep it to a few counties or
   districts unless they ask for more, since every task needs imagery. Ask for the years
   and season; when they do not know which dates tell the labels apart, propose them from
   the crop calendar or the years of the change and say why. Ask for the labels and what
   each means, how many tasks and how they are placed (random or grid in the box, or their
   own points), and whether they want time series.
3. `setup_options(project_id)`: imagery collections with their visualizations, basemaps,
   and time series sources and types. On a `render_browser` note, ask the user before
   `install_render_browsers`.
4. **Put the full proposal to the user** in one message: name and project, box, labels and
   task output, every imagery source (collection, visualizations, max cloud cover, each
   window with its slices and cover as dates), basemaps, time series, the guide in full,
   and the tasks. Revise until they explicitly accept; silence or "looks interesting" is
   not acceptance.
5. `create_campaign(project_id, settings, imagery, basemaps?, timeseries?)` with exactly the
   accepted values, then `add_tasks(campaign_id, task_set, ...)` with `geojson` (the user's
   points as a FeatureCollection) or `sampling` (`{"strategy_type": "random",
   "num_samples": 100, "seed": 1}` or `{"strategy_type": "grid", "spacing_km": 5}`).
6. `get_campaign(campaign_id)` about every 30 seconds until `registration_status` is
   `ready`; on `failed`, report `registration_errors`.
7. `preview_campaign(campaign_id, max_image_edge_px, max_image_megapixels)`: check the
   imagery shows what the labels need (cloud-free dates, a zoom where the classes differ);
   if not, propose a change.
8. Give the user the campaign `url`. The first time they open it they set up the workspace
   (the first view and its layout) before people can annotate; agents do not need it. To
   label with agents, use the labelling skill.

Anything beyond the accepted proposal, afterwards or added by you, is a new proposal: put
it to the user and wait for acceptance again.

## Changing an existing campaign

Read it with `get_campaign(campaign_id)`, propose the change as a before and after, and
wait for acceptance. Settings: `edit_campaign(campaign_id, settings)` with only what
changes. Imagery: `edit_imagery(campaign_id, imagery?, remove?, basemaps?)`. A recipe named
like a stored source becomes exactly that recipe, so list every window it should keep, as
`get_campaign` shows them; other recipes are added and sources you do not name stay as
they are. Replacing a source the user made with the generator turns it into plain windows
they can no longer re-cut with it: say so first. Changed imagery registers again, so
follow with steps 6 and 7.

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
