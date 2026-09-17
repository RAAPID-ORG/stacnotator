---
name: stacnotator-labelling
description: Label STACNotator campaign tasks from satellite imagery through the stacnotator MCP server - register labelling agents, look at each point step by step, and submit labels. Use when asked to label, annotate or classify points in a STACNotator campaign, or to run several labelling agents over one.
---

# Labelling a STACNotator campaign

First ask the user for the full URL of the STACNotator to label on (`https://...`), every
session, even if you used one before; never assume or complete one. Then `login(url)`. A
`render_browser` note from `register_agent`: ask the user before `install_render_browsers`,
then call `campaign_context`. Never register the same worker twice.

## Tools

| tool | use |
| --- | --- |
| `login(url)`, `list_campaigns()`, `list_agents(campaign_id)` | sign in; find the campaign; open tasks and your agents |
| `register_agent(campaign_id, name, max_image_edge_px, max_image_megapixels, description?, task_count=10, task_set_id?, takes_over_work?, default_views?)` | one agent per worker; returns `agent_id`, context, default views |
| `campaign_context(agent_id)` | guide, labels, form fields, imagery, basemaps, time series |
| `next_task(agent_id)`, `get_views(agent_id, task_id, views)` | the current task with its first look; more views of it |
| `set_default_views(agent_id, views)`, `set_image_limits(...)` | change the first look; restore limits after a restart |
| `submit_label(agent_id, task_id, label_id, confidence, comment, form_values?, flagged_for_review?, flag_comment?)`, `skip_task(agent_id, task_id, comment)` | finish the task |
| `release_tasks(campaign_id, agent_id?)`, `watch_agents()` | free unfinished tasks; watch window when the user asks |

Image limits: the largest image your model takes in without downscaling. You know them.

## Per point

Read the guide, `labels` and `form_fields` first. Then:

1. `next_task`: a first look - a few dates across the season zoomed on the point, the time
   series, and a basemap pair (surroundings, close up).
2. List everything still unclear and request it all in **one** `get_views` call, packed:
   dates to compare side by side in one view at one zoom, context and close up in one view
   via per-cell `zoom`, a second view only where cell size must differ. Repeat only for
   something new. Typical needs: the months around a change in the time series (covers or
   finer slices); higher zoom or a basemap close up for a small point; neighbouring dates
   for clouds; another `visualization`; the chart with `remove_cloudy` and `smoothed`.
3. `submit_label`, or `skip_task` with the reason when the imagery cannot tell.

Views most points need belong in the first look (`set_default_views`), which is also drawn
ahead for your next tasks. `task: null` means done.

## Views

`{"cells": [...], "columns": 4, "cell_px": 320, "zoom": 15}`; each cell is one of
`{"slice_id", "visualization"?}`, `{"basemap_id"}`, `{"timeseries_ids": [...]}`, with an
optional own `"zoom"`. At most 36 cells per view, 8 views per call; a chart takes a full row;
`cell_px` shrinks to fit your limits.

```json
[{"columns": 4, "cell_px": 384, "zoom": 17,
  "cells": [{"slice_id": 132}, {"slice_id": 133}, {"slice_id": 134},
            {"basemap_id": 2, "zoom": 13}]}]
```

Meters per pixel = 156543 * cos(lat) / 2^zoom. Past `max_native_zoom` pixels only get bigger.
`on_demand` sources search Planet around the point, so a date can be empty.

Reading: the thin red box sits just outside the sample extent (a crosshair when too small);
cells are labelled `#i date, zoom` and match `meta.cells[i]`; basemaps have no date and can be
old; `inside_box` gives `mean_rgb`, `green_index` (above ~0.1 usually vegetation),
`bright_share` (cloud), `no_data_share`; `(!)` and hatched grey mean no data; time series
values are in `series[].rows`.

## Labels

- `label_id` from the context, by the guide's definitions; fill required `form_values`
  (keyed by field id).
- `confidence` 0-5 honestly: 5 no doubt, 0 a guess.
- `comment`: your reasoning - what the relevant dates and views showed, why that means this
  label, what ruled out the close alternatives, what stays uncertain.
- A label fits but a human should check: `flagged_for_review` with `flag_comment`.

## Several agents

1. Ask in one message for what is missing: the full URL, campaign, number of points,
   number of agents (suggest one per 5 points, at most 8). `list_agents` says how many
   tasks you can hand out: campaign admins from the open pool, other project members only
   their own assigned tasks.
2. Register the agents one at a time with the workers' image limits, names like `scout-a`,
   tasks split evenly, `takes_over_work: true`.
3. Start one subagent per agent in parallel (without subagents: work them yourself in turn,
   or ask the user to open one session per agent) with this brief:

   > Label STACNotator campaign {id} as agent {agent_id} with the stacnotator tools, always
   > passing this agent_id. Labels: {id: name}. Guide: {two lines}. Per task: next_task, one
   > packed get_views for everything unclear (again only if needed), then submit_label with
   > confidence 0-5 and a comment explaining the decision, or skip_task with the reason.
   > Stop at task null. Reply one line per task: id, label, confidence, short reason.

4. Stopped early: `release_tasks(campaign_id)`. Report agent, task, label, confidence; point
   out skips and low confidence.
