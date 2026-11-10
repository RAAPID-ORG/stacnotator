---
name: stacnotator-labelling
description: Label STACNotator campaign tasks from satellite imagery through the stacnotator MCP server - register labelling agents, look at each point step by step, and submit labels. Use when asked to label, annotate or classify points in a STACNotator campaign, or to run several labelling agents over one.
---

# Labelling a STACNotator campaign

First ask the user for the full URL of the STACNotator to label on (`https://...`), every
session, even if you used one before; never assume or complete one. A subagent takes it from
its brief instead. Then `login(url)`. A
`render_browser` note from `register_agent`: ask the user before `install_render_browsers`,
then call `campaign_context`. Never register the same worker twice.

Once the agents are registered, say in that same reply that a window on their screen is
showing what the agents look at, and give them `agents_page` from `register_agent` to follow
progress, switch take-over and free tasks.

## Tools

| tool | use |
| --- | --- |
| `login(url)`, `list_campaigns()`, `list_agents(campaign_id)` | sign in; find the campaign; open tasks and your agents |
| `register_agent(campaign_id, name, max_image_edge_px, max_image_megapixels, description?, task_count=10, task_set_id?, takes_over_work?, default_views?)` | one agent per worker; returns `agent_id`, `agents_page`, context, default views |
| `campaign_context(agent_id)` | guide, labels, form fields, imagery, basemaps, time series |
| `next_task(agent_id)`, `get_views(agent_id, task_id, views)` | the current task with its first look; more views of it |
| `probe_timeseries(agent_id, task_id, points, timeseries_ids?, remove_cloudy=true, smoothed?)` | click 1-6 places on a map you were shown and chart their time series beside the task's |
| `set_default_views(agent_id, views)`, `set_image_limits(...)` | change the first look; restore limits after a restart |
| `submit_label(agent_id, task_id, label_id, confidence, comment, form_values?, flagged_for_review?, flag_comment?)`, `skip_task(agent_id, task_id, comment)` | finish the task |
| `release_tasks(campaign_id, agent_id?)`, `watch_agents()` | free unfinished tasks; reopen the watch window the user closed |

Image limits: the largest image your model takes in without downscaling. You know them.

## Per point

Read the guide, `labels` and `form_fields` first. Then:

1. `next_task`: a first look - a few dates across the season zoomed on the point, the time
   series, and a basemap pair (surroundings, close up).
2. List everything still unclear and request it all in **one** `get_views` call, packed:
   dates to compare side by side in one view at one zoom, context and close up in one view
   via per-cell `zoom`, a second view only where cell size must differ. Repeat only for
   something new. Typical needs: the months around a change in the time series (covers or
   finer slices); zoom out to find nearby fields, then open a selected field at higher zoom
   and browse its imagery (see Exploring nearby); higher zoom or a basemap close up for a small point; neighbouring dates
   for clouds; another `visualization`; the chart with `remove_cloudy` and `smoothed`.
3. Optional: `probe_timeseries` when comparing places helps - fields nearby that look like
   the task, or like each class (see Probing).
4. `submit_label`, or `skip_task` with the reason when the imagery cannot tell.

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
cells are labelled `#i date, zoom` and match `meta.cells[i]`, whose `rect` is `[x, y, w, h]`
in image pixels; `inside_box` gives `mean_rgb`, `green_index` (above ~0.1 usually vegetation),
`bright_share` (cloud), `no_data_share`; `(!)` and hatched grey mean no data; time series
values are in `series[].rows`.

Basemaps have no date: they can be years old and from any season. Use them only for
lasting context (field edges, roads, buildings, water), never as evidence of what grows,
when, or whether something changed. Where the label depends on dates or seasonality, decide
from the dated slices and the time series; a basemap that disagrees with them is out of date.

## Probing

`probe_timeseries` loads the time series wherever you click, like the timeseries tool on
the annotation page. Typical use: get a zoomed-out view of the surroundings (one slice,
lower `zoom`, large `cell_px`), spot 2-3 fields that look like the task (or like each
candidate label), then probe them to see whether their seasons match the task's.

- A point is `{"reply", "image", "x", "y"}`: a pixel of image `image` (1-based) of the
  reply numbered `reply` (every `next_task`, `get_views` and `probe_timeseries` reply with
  images has a `reply` number; your last 8 for the current task can be picked on), counted
  in that image's own pixels from its top-left corner, on a map cell; the pixel becomes a
  place through that cell's zoom. Or `{"lat", "lon"}`.
- Aim at the middle of a uniform patch, not at its edge: a pixel is `m_per_px` wide.
- The reply redraws each cell you clicked, in the order of your points, over the same ground
  (its size and zoom may change to fit your image limits), with every point marked `P1`,
  `P2`... at the exact pixel it resolved to, on every cell that covers it. Then one chart
  per time series: the task line plus a line per point in its marker's colour. **Check
  each marker sits where you meant before reading the charts.** If one is off, probe again
  on that reply's image (its new `reply` number, image 1), correcting `x`, `y`.
- `meta.probes` gives each point's `lat`, `lon` and `east_m`/`north_m` from the task;
  values are in `series[].rows` per `point`.

## Exploring nearby

Use imagery, not just time series, to investigate surrounding fields. First ask for a
wide view (lower `zoom`). Pick a promising patch in that returned image, then give
`get_views` a `center` and a higher zoom:

```json
[{"center": {"reply": 123456, "image": 1, "x": 310, "y": 120},
  "zoom": 18, "columns": 2, "cell_px": 512,
  "cells": [{"slice_id": 132}, {"slice_id": 133}]}]
```

Use the real reply number and pixels from the image you received, not these example
values. No latitude/longitude is needed. The selected location becomes the centre for
every cell in this view. Inspect different dates, visualizations, basemaps or its time
series there; select another pixel on the new image to move again, or select its centre
pixel to stay there while changing dates or zoom. A cell can override `center` to mix
locations in one grid. Omit `center` to return to the assigned task.

The red box still marks the original task at its actual position; it may now be outside
the view. Never label the nearby field instead of the assigned task. `meta.cells[].center`
reports where each cell looks, `task_in_view` says whether the point task is visible, and
`inside_box` is present only when its whole sample extent is in frame. Probing a pixel on
these images works exactly as on the original task images. Default views cannot have a
fixed centre because they must follow each new task.

## Recording

The MCP server records returned views, exploration requests, time-series probes and
submitted answers in a local JSONL log, independently of the watch window.
`register_agent` and `watch_agents` return its path. It preserves actual returned images,
locations and submitted explanations, not private reasoning or the surrounding
conversation. Include the evidence for your decision in the submitted comment.
Ask before sharing recordings.

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

   > Label STACNotator campaign {id} on {full URL} as agent {agent_id} with the stacnotator
   > tools: call login with that URL first, and always pass this agent_id. Labels: {id: name}. Guide: {two lines}. Per task: next_task, one
   > packed get_views for everything unclear (again only if needed), probe_timeseries on
   > look-alike places when comparing helps, never a basemap as evidence of dates or season,
   > then submit_label with
   > confidence 0-5 and a comment explaining the decision, or skip_task with the reason.
   > Stop at task null. Reply one line per task: id, label, confidence, short reason.

4. Stopped early: `release_tasks(campaign_id)`. Report agent, task, label, confidence; point
   out skips and low confidence.
