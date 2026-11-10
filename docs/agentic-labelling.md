# Agentic labelling

A model can set up a new campaign and label the tasks of a campaign, alone or as a team of
subagents. It works through the `stacnotator` MCP server in the SDK: it looks at packed
images of the imagery around each task, asks for more detail when a point is unclear, and
submits labels like any other annotator.

## Setup

Install the plugin, which brings the labelling and campaign setup skills and the MCP server. You need
[uv](https://docs.astral.sh/uv/); there is nothing to clone or run yourself.

Claude Code:

```
/plugin marketplace add RAAPID-ORG/stacnotator
/plugin install stacnotator@stacnotator
```

Codex:

```bash
codex plugin marketplace add RAAPID-ORG/stacnotator
codex plugin add stacnotator@stacnotator
```

The agent always asks which STACNotator to use and needs its full URL. Then ask, e.g. "label 20 points of the Ukraine winter crop campaign on
https://your-stacnotator.example.org with 4 agents". The agent signs you in through a
browser tab the first time and asks once before downloading Chromium (about 150 MB), which
draws the images. The first start takes a minute while uv installs the SDK.

Other MCP clients: run
`uvx --from "stacnotator-sdk[agent] @ git+https://github.com/RAAPID-ORG/stacnotator#subdirectory=sdk" stacnotator-mcp`
over stdio and give the model
[`sdk/skills/stacnotator-labelling/SKILL.md`](../sdk/skills/stacnotator-labelling/SKILL.md)
and [`sdk/skills/stacnotator-campaign-setup/SKILL.md`](../sdk/skills/stacnotator-campaign-setup/SKILL.md).

On a bare Linux machine Chromium may also need system libraries:
`uvx playwright install-deps chromium` (needs sudo).

A campaign with point tasks needs a sample extent set: it is the red box drawn around each
point so the model knows what it is labelling.

## Setting up a campaign

Tools that create or change campaigns are off unless you grant them. The MCP server offers
only the ones named in `STACNOTATOR_MCP_ALLOW`, comma-separated, out of:

| tool | what it does |
| --- | --- |
| `create_campaign` | creates a campaign with its area, labels, guide, imagery and time series |
| `add_tasks` | adds tasks from GeoJSON, or random or grid sampling |
| `edit_campaign` | changes an existing campaign's settings, such as its name, guide, labels, area or form fields |
| `edit_imagery` | adds, replaces or removes an existing campaign's imagery sources and sets its basemaps |

Set the variable before you start the client, for example
`STACNOTATOR_MCP_ALLOW=create_campaign,add_tasks claude`, or in Windows PowerShell
`$env:STACNOTATOR_MCP_ALLOW="create_campaign,add_tasks"; claude`. A model never sees a tool you did
not grant, and the server instructions tell it to report that instead of making the change
another way. This is a limit of the tool set, not a permission: the SDK login is your own
session, so a model with shell access could still call the API with it.

Ask in plain words, e.g. "set up a campaign to label maize vs other crops in Nakuru county,
Kenya". The skill does not fill in what you left open. It asks where (an administrative unit
or an exact box), when (years and season, with dates it proposes from the crop calendar for
you to confirm), the labels and how tasks are placed. Administrative units are looked up in
[geoBoundaries](https://www.geoboundaries.org) (gbOpen) with `find_area`, which reads one
country and level at a time as simplified GeoJSON; the skill shows you the matching units
and their boundary year before using one.

It then puts the whole proposal to you in the chat: area, labels, guide, every imagery
window with its slices and cover, basemaps, time series and tasks. Only after you accept it
does it:

1. create the campaign in a project you administer,
2. add tasks from GeoJSON (points or polygons), or random or grid sampling inside the unit's
   outline or across the campaign box,
3. wait until the imagery is registered and draw the first tasks' views as a preview,
4. give you the campaign's link.

Changing an existing campaign works the same way: the skill reads it with `get_campaign`,
proposes the change and calls `edit_campaign` or `edit_imagery` once you accept.

Imagery is described by recipes over the Planetary Computer collections the campaign wizard
offers as presets. A recipe spells out each window, its slices and its cover as date ranges,
so the agent chooses the dates that tell the labels apart, such as the months around a crop's
peak in each year. The headless page builds each window with the wizard's own presets and
collection builder (`layers/imagery/recipe.ts`), so an agent-made source is searched and drawn
exactly like one made in the wizard. `edit_imagery` merges recipes into the campaign's
imagery by source name: a recipe with a stored source's name replaces it in place, so the
views that show it keep it, and sources it does not name stay as they are.

## Running a labelling run

Ask in plain words, e.g. "label 20 points of the Ukraine winter crop campaign with 4 agents".
The skill asks for whatever is missing (campaign, number of points, number of agents), then:

1. registers one agent per worker, with the points split evenly and take-over switched on,
2. launches one subagent per agent, each looping next task, extra views when needed, label or skip,
3. reports a table of task, label, confidence and evidence.

Registering also opens a window on your screen with each agent's latest views, which
explains what you are looking at and where to follow progress; closing it does not stop the
agents, and `watch_agents` reopens it. If you stop a run early, ask it to free the agents'
tasks, or use the Agents page.

## How it works

```mermaid
sequenceDiagram
    participant M as Model / subagent
    participant S as MCP server (SDK)
    participant P as Headless page per agent
    participant B as Backend
    M->>S: next_task(agent_id)
    S->>B: POST /agents/{id}/next
    B-->>S: current task + next two
    S->>P: render(task, default views)
    P->>B: campaign, tile tokens, time series
    P-->>S: JPEGs + per-cell metadata
    S->>P: preload(next two tasks)
    S-->>M: task JSON + images
    M->>S: submit_label(...)
    S->>B: POST /agents/{id}/tasks/{task}/annotate
```

- **Who can run agents.** Only project members. Campaign admins hand agents tasks from the
  open pool; other members only the tasks assigned to themselves, and freeing an agent's
  unfinished tasks gives them back to that member. At most 20 agents per person in a
  campaign.
- **Agents are annotators.** Registering creates a user owned by the signed-in account, adds
  it to the project and assigns it tasks with the normal assignment code. Labels, skips,
  statistics and review rows are ordinary annotations. `data.labelling_agents` only records
  the owner, campaign, description and the take-over setting.
- **Agents are not members.** They hold a project membership row so assignments work, but a
  run is temporary, so they are left out of the project members list, the users an admin can
  add, and the campaign's `users.csv`. Their work still shows up wherever annotations are
  attributed: statistics, the review page and the annotation exports.
- **Nothing is rendered on the server.** The MCP server opens `/agent-render?campaign=<id>`
  of the app in its own browser context per agent (so agents do not share tile connections)
  and calls `window.stacnotatorAgent` on it. The page draws with the same catalog, tile URLs,
  Planet scene search and time series code as the annotation page and returns the images.
  It signs in with the SDK login, which the MCP server hands to the page on request. For
  campaign setup it opens `/agent-render?project=<id>` instead, which exposes
  `window.stacnotatorSetup` to list the setup options, build a new campaign's imagery and
  merge recipes into an existing campaign's imagery.
- **Campaign context and default views come from the page**, built from the campaign it
  loaded: sources with collections and slices, basemaps, time series, labels, form fields
  and the guide.
- **Views.** A view is a grid of cells, each a slice (with a visualization), a basemap or a
  time series chart (optionally cloud-free and smoothed), at a zoom and cell size the model
  picks. Each cell carries a short readable label (`#3 May 2025, z17`); the metadata adds
  the exact dates, zoom, meters per pixel, the time series values and, for point tasks, the
  pixels inside the sample extent as numbers (mean colour, a green index, the share of
  bright and of missing pixels). Areas without tiles are hatched and flagged, and the red box
  is drawn outside the extent so nothing inside it is covered.
- **Image limits.** Models downscale large images before they see them, which silently
  loses detail. The model states the largest image it takes in unchanged when it registers
  an agent, and every view is fitted to that by shrinking its cells.
- **Step by step per point.** `next_task` returns a light first look (a few dates spread over
  the season, zoomed on the point, the time series and a basemap pair); the agent then calls
  `get_views` on the same point as often as it needs for other dates, zooms, cell sizes,
  visualizations or basemaps. Drawn views are cached, so asking again costs nothing.
- **Preloading.** Every `next_task` draws the agent's default views for its next two tasks in
  the background, so a steady loop gets its images without waiting. Default views live in
  the MCP server's memory and reset when it restarts.
- **Take-over.** An agent with take-over on that runs out of tasks takes the last queued task
  of the owner's agent on the campaign with the most work left.

## Agents page

`/projects/<p>/campaigns/<c>/agents` lists your agents on a campaign with done and remaining
counts and when each last submitted a label, so a run that died is easy to spot. From there you can switch take-over per agent and free the unfinished tasks of one
agent or of all of them; labelled and skipped tasks stay. The page also explains the feature
and how to install the plugin, and the campaign overview links to it under the task sets.

## API

| route | |
| --- | --- |
| `POST /campaigns/{id}/agents` | register an agent and assign it `task_count` tasks |
| `GET /campaigns/{id}/agents` | total and open tasks, and your agents with their progress |
| `POST /campaigns/{id}/agents/release-tasks?agent_id=` | free unfinished tasks of one or all of your agents |
| `GET /agents/{agent_id}` | one agent |
| `PATCH /agents/{agent_id}` | switch take-over |
| `POST /agents/{agent_id}/next` | the current task and the next two, taking over work when empty |
| `POST /agents/{agent_id}/tasks/{task_id}/annotate` | label or skip |

## Limits

- Agents set up imagery only from the Planetary Computer presets. Other catalogs, Planet,
  custom maps and vector layers are added by a person in the app; `edit_imagery` keeps them
  as they are.
- Everything runs on the machine of whoever runs the MCP server: each agent's page is a
  Chromium renderer drawing several maps at once, so many parallel agents are bound by that
  machine's memory and CPU.
- Registrations go one at a time: task assignment locks the campaign's open pool, so two at
  once would leave the second agent without tasks.
