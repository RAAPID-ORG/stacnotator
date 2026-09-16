---
name: stacnotator-labelling
description: Label STACNotator campaign tasks from satellite imagery through the stacnotator MCP server - register labelling agents, pull tasks with rendered map views, choose what imagery to look at per point, and submit labels. Use when asked to label, annotate or classify points in a STACNotator campaign, or to run several labelling subagents over one.
---

# Labelling a STACNotator campaign

You label the tasks (points) of a campaign as an agent. For each task you get images of
the imagery around the point, decide what else you need to see, and submit a label. You
choose the views - that choice is most of the job.

## Setup (once, by the user)

```bash
pip install "./sdk[agent]"                 # from the stacnotator repo root
python -c 'import stacnotator as snt; snt.login("https://your-stacnotator.example.org")'
claude mcp add stacnotator -- python -m stacnotator.agent_mcp
```

Other MCP clients: run `python -m stacnotator.agent_mcp` over stdio.

**Images are drawn by the user's browser, not the server.** The user must keep the
campaign's Agents page open (`render_host_url` from `register_agent`, e.g.
`https://.../projects/3/campaigns/12/agents`). With no page open, views come back with
`status` other than `done` and an `error` saying so - stop and ask the user to open it,
don't label blind. `next_task`/`get_views` can wait up to ~2 minutes for drawing; if your
client cuts tool calls off sooner, raise its timeout (Claude Code: `MCP_TOOL_TIMEOUT`, ms).

## Tools

| tool | use |
| --- | --- |
| `list_campaigns()` | campaigns you can access, to ask which one to label |
| `campaign_work(campaign_id)` | total and open tasks plus your existing agents, to size the run |
| `register_agent(campaign_id, name, description?, task_count=10, task_set_id?, default_views?, takes_over_work?)` | create an agent, returns `agent.agent_id`, the campaign context and `render_host_url` |
| `campaign_context(agent_id)` | guide, labels, form fields, imagery slices, basemaps, time series |
| `list_agents(campaign_id)` | your agents with assigned/remaining counts |
| `request_tasks(agent_id, count, task_set_id?)` | assign more tasks |
| `next_task(agent_id)` | next open task + its default views |
| `get_views(agent_id, task_id, views)` | one-off extra views of the current task |
| `set_default_views(agent_id, views)` | change what every task comes with (and what is preloaded) |
| `submit_label(agent_id, task_id, label_id, confidence?, comment?, form_values?, flagged_for_review?, flag_comment?)` | label it |
| `skip_task(agent_id, task_id, comment)` | skip with a reason |

## Workflow

1. `register_agent` - one agent per worker, each with its own short name
   (`[a-zA-Z0-9._-]`, max 20) and `task_count`. Keep the `agent_id`.
2. Read the context: `guide_markdown` is the labelling protocol, `labels` gives the ids you
   submit, `form_fields` lists extra questions (note `required`). Note what imagery exists:
   sources -> collections (periods, e.g. months) -> slices (finer, e.g. weeks), each
   collection's `cover_slice_id` (a composite of the period), `visualizations` per source,
   `max_native_zoom`, basemaps and time series. Sources with `on_demand: true` (Planet
   daily scenes) are searched around each task when you ask: the first view of a task
   takes several seconds, and a date may hold nothing there (the cell caption then starts
   with `no image:`). Their collection covers are the cheapest way to see which periods have data.
3. Loop:
   - `next_task(agent_id)` - returns the agent's **default views**. Those are also what gets
     preloaded: whenever you call it, the browser draws the same views for your next two
     tasks, so the next call is usually instant. The defaults come from `register_agent`
     (built in when omitted) and can be replaced any time with `set_default_views`, e.g. once
     the first tasks show which periods or zooms matter in this campaign.
   - Look. If the answer is clear, label. If not, `get_views` for exactly what would settle it.
   - `submit_label` or `skip_task`.
   - `task: null` means your assigned tasks are done. `request_tasks` if more work is wanted.

`next_task` keeps returning the same task until you label or skip it.

## Deciding what to look at

Start from the defaults, then drill in only where it is ambiguous:

- **Default views**: one image with the covers of the first source's most recent periods
  (up to 16) plus the cloud-free time series chart, and a basemap pair (wide context and
  close up).
- **Noisy time series?** Ask for the chart again with `"remove_cloudy": true` (drops the
  cloud-flagged observations, otherwise drawn as grey dots) and `"smoothed": true`
  (Savitzky-Golay line; `meta` then carries a `smoothed` column next to the raw values).
- **Ambiguous crop/phenology?** Look at the finer slices of the one or two periods that
  matter (e.g. the weeks around green-up or harvest) and read the time series values in `meta`.
- **Cloudy or hazy cover?** Try the individual slices of that period, or a neighbouring period.
- **Can't tell the land cover from true colour?** Ask for another visualization
  (false colour / NDVI style) if the source lists one.
- **Unsure where the field or object boundary is?** A high zoom detail view, plus a
  basemap at high zoom for sharper geometry.
- **Unsure about the landscape?** A low zoom context view.

Every map cell is centred on the task. A point task gets a red box of the campaign's
`sample_extent_meters` around it: label what is inside the box. When the box would be
only a few pixels wide at that zoom, a crosshair marks the point instead, which is a hint
to zoom in. Polygon tasks show their own outline. The caption says the source, date and
zoom. The `meta` of each view describes every cell (`index`, `kind`, position, `caption`,
`zoom`, `meters_per_pixel`, and raw values for time series cells).

### Context views vs detail views

- **Context**: lower zoom, several cells - 3-4 columns of 256-320 px. Shows landscape,
  field patterns, roads, water, settlements.
- **Detail**: high zoom, few big cells - 1-2 columns of 512-768 px, tightly around the point.
- **Mixing**: `zoom` on a cell overrides the view's zoom for that cell, so one image can
  hold a wide context cell next to close ups.

Meters per pixel = 156543.03 * cos(lat) / 2^zoom. Width of a cell at the equator
(multiply by cos(lat), about 0.7 at 45 degrees):

| zoom | m/px | 320 px cell | 768 px cell |
| --- | --- | --- | --- |
| 12 | 38 | 12 km | 29 km |
| 13 | 19 | 6.1 km | 15 km |
| 14 | 9.6 | 3.1 km | 7.3 km |
| 15 | 4.8 | 1.5 km | 3.7 km |
| 16 | 2.4 | 760 m | 1.8 km |
| 17 | 1.2 | 380 m | 920 m |
| 18 | 0.6 | 190 m | 460 m |

Zooming past a source's `max_native_zoom` only upsamples: no new detail. For 10 m imagery
(e.g. Sentinel-2) z14-15 is already native; go higher on basemaps, not on the slices.

### Packing

- Prefer one dense image over many small calls: up to 36 cells in a view, 8 views per call.
- `columns * cell_px <= 2048`. Cells fill left to right; a time series cell closes the current
  row and takes a whole row of its own, `max(180, 0.75 * cell_px)` px high.
- Images you receive are downscaled to roughly 1568 px on the long edge and about
  1.15 megapixels. A 6x6 grid of 320 px cells (1920 px square) reaches you at under 200 px
  per cell, a 4x2 grid of 320 px cells arrives untouched. More cells means less detail per cell:
  use many cells for comparing dates, few big ones for fine detail.
- Don't ask for what you already have. Every view costs context.
- What you need for almost every task belongs in the default views (preloaded); what you
  need now and then belongs in `get_views` (drawn on demand, a few seconds).

## View examples

Ids below are made up - take real ones from the context.

Overview of six monthly covers plus two time series (NDVI and precipitation):

```json
[{"columns": 3, "cell_px": 384, "zoom": 15,
  "cells": [{"slice_id": 101}, {"slice_id": 111}, {"slice_id": 121},
            {"slice_id": 131}, {"slice_id": 141}, {"slice_id": 151},
            {"timeseries_ids": [4, 5], "remove_cloudy": true, "smoothed": true}]}]
```

Detail of the three weekly slices of one month at z17, big cells:

```json
[{"columns": 3, "cell_px": 512, "zoom": 17,
  "cells": [{"slice_id": 132}, {"slice_id": 133}, {"slice_id": 134}]}]
```

Basemap context and detail in one image using per-cell zoom:

```json
[{"columns": 2, "cell_px": 768, "zoom": 17,
  "cells": [{"basemap_id": 2, "zoom": 13}, {"basemap_id": 2}]}]
```

True colour vs false colour for the same periods (visualization names from the source):

```json
[{"columns": 4, "cell_px": 320, "zoom": 15,
  "cells": [{"slice_id": 131, "visualization": "True Color"},
            {"slice_id": 141, "visualization": "True Color"},
            {"slice_id": 131, "visualization": "False Color"},
            {"slice_id": 141, "visualization": "False Color"}]}]
```

Custom `default_views` passed to `register_agent` use the same shape (max 4) and replace
the built-in overview for every task.

## Labelling discipline

- `label_id` must come from the context's `labels`. Follow the guide's definitions, not your own.
- Fill every required form field. `form_values` is keyed by field id as a string: category
  -> option id, multicategory -> list of option ids, number, text, date `"YYYY-MM-DD"`,
  daterange `{"start": ..., "end": ...}`.
- `confidence` 0-10, honestly. A 9 should mean you would bet on it.
- `comment`: one or two lines of evidence ("green-up in May slices, harvested by August,
  regular field boundaries at z17").
- Can't decide from the imagery (clouds everywhere, no data, class not in the guide)?
  `skip_task` with the reason. A skip is better than a guess.
- Picked a label but a human should check it? `flagged_for_review: true` with a `flag_comment`.
- A tool error (bad id, missing required field) comes back as a readable message: fix and retry.

## Orchestrating subagents

Users ask in plain words ("label 20 points of campaign 12 with 4 agents in parallel").
Turn that into:

1. **Fill in what is missing by asking, never by guessing.** Three inputs decide a run:
   - **Campaign**: if not named, call `list_campaigns` and ask which one.
   - **Points**: if not given, call `campaign_work` and ask how many to label, stating how
     many are open (e.g. "240 open tasks - how many should I label? 20 is a good first run").
   - **Agents**: if not given, recommend one agent per 5 points, at least 1 and at most 5
     (one browser tab draws for all of them), and ask to confirm.
   Ask for everything missing in one message, then wait for the answer.
2. **Split** the points as evenly as possible over the agents (20 over 3 is 7, 7, 6), never
   more than `open_tasks`, and never register an agent with no tasks.
3. **Register** one agent per worker yourself, named after the campaign or role plus a
   letter (`scout-a`, `scout-b`, ...), all with `takes_over_work: true` so a fast worker
   picks up a slow one's queue. Tell the user the `render_host_url` once and ask them to
   keep it open.
4. **Launch** one subagent per agent, all in parallel, each with this brief filled in:

   > You are labelling STACNotator campaign {id} as agent {agent_id}. Use the stacnotator
   > MCP tools and always pass this agent_id. Labels: {id: name, ...}. Guide: {two or three
   > line summary}. Loop: next_task, look at the default views, use get_views only when the
   > point is still ambiguous (at most one or two per task), then submit_label with an
   > honest confidence and a one line evidence comment, or skip_task with a reason. Stop
   > when next_task returns task null. Reply with one line per task: task id, label,
   > confidence, evidence. Do not describe the images.

5. **Report** a table of agent, task, label and confidence, and point out skips, low
   confidence and anything odd about the sample.

Further rules:

- All subagents share one MCP server, so every call passes that worker's `agent_id`.
  Never let two workers use the same `agent_id`: they would fight over the same next task.
- Images fill context fast, so a subagent returns a short summary, not what it saw.
- `takes_over_work` moves the last queued task of whichever of your other agents on the
  campaign has the most left (never the one it is about to work on). The owner can flip it
  per agent with the checkbox on the Agents page.
- One browser tab draws the views for all of your agents on that campaign, so many workers
  asking for heavy one-off views will queue up. Put what you need every time in the
  default views so it stays preloaded, and use `get_views` sparingly.
