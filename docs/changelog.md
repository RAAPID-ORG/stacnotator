# Development changelog

## 2026-10-21 - Project-only catalogs

Catalog setup now has four numbered sections: connect storage, select files and dates,
index files, and configure display. Distinct headers separate the steps; opening a catalog
scrolls to its row. **Edit** replaces **Open** and expands setup directly below
that catalog, with a **Close** toggle. Indexing has a progress bar and its own action section.
Catalog title and SAS edits live in step 1; step 4 contains detected bands and visualization
presets only. Both forms show saving/saved feedback, clear it on edits, and send only their
own fields so a visualization save cannot overwrite catalog details.
Storage region is an alphabetized Azure region dropdown instead of free text, with
an optional **Not specified** default and canonical region identifiers in requests.

UI follow-up: **Set asset names in bulk** replaces manual grouping, directly below
date extraction. Rules only change names and show live match counts beside each
pattern. A compact toolbar provides **+**, matching-only selection, and inline
**Apply**; matching-only selects matching listed files and deselects the rest.
Selected files group automatically by equal dates or identical intervals.
The editor accepts `YYYY-MM-DD` dates and explicit intervals, without month inference.
Date extraction help is aligned beside the disclosure title.
Selection is a table-header checkbox; asset names have their own input column.
CSV dates open in a popup from the Date header. Interval dates sit side by side
in 128px fields, vertically centered with the checkbox.
Band-name editing now follows indexing, with one field per detected band and
persistent catalog display names; raw rasters and STAC metadata stay unchanged.

Removed organization catalog ownership and management to reduce scope. Catalogs
use project-admin permissions and a required project ID. The original unreleased
migration now creates project-only catalogs; the tiler contract is unchanged.
Moved the campaign cloud-catalog picker under Custom (other), alongside STAC and
XYZ choices. A focused browser case covers the new section and return navigation.
The cloud imagery card now has one small top-right Manage link, which opens and scrolls
to project imagery settings; removed the Refresh action and repeated instructions.
Added catalog deletion with confirmation, including drafts without contacting the
tiler. Discovered files start selected, with a select/unselect-all control. The
date regex is above the list; Apply can select only matching files. Date rows now
use compact inputs with an Interval checkbox. Optional filename date extraction
starts collapsed, with a question-mark example.
The catalog UI now says indexing rather than importing, with the shorter
"Times are in UTC." hint in the Time column's question mark. Internal API names
are unchanged.

Added multi-asset items and bulk asset-name rules; not every file has to match.
Band counts and embedded names are
detected automatically during indexing and shown in the catalog. The tiler records raster band metadata and returns it
to the existing visualization editors. Whole-item batching preserves retry
checkpoints. The original migration includes the new metadata/grouping columns;
local catalogs were preserved with additive schema changes. Focused core, tiler,
browser and unit checks pass; a real local pgstac check covers multi-asset metadata
round trips. Actual Azure data indexing and rendered-tile acceptance remain open.

## 2026-10-20 - Catalog navigation simplification

Moved organization management into Details/Members/API keys/Imagery tabs and
project catalog management into Settings. Catalog creation now takes its owner
from the page, without a sharing selector. Legacy links retain selected catalogs.
Commit `d565144e`; eight browser cases and live desktop/narrow-screen checks pass.
See [navigation report](review/implement-catalog-navigation/report.md).

Follow-up: added space below organization tabs, moved New catalog into the existing
modal, removed the organization-page guidance, and placed project imagery above
Delete project. The eight focused browser cases remain green; live 390px/1440px
checks cover popup placement/cancellation, spacing, and section order.

## 2026-10-20 - Azure imagery catalogs

Implemented issue #158 on a develop-based feature branch and activated it in the
local app without resetting the existing seeded database. Imports reuse bounded
registration workers; metadata failures remain visible, and catalog presets are
copied through the existing imagery editor.

Core: `68802fe8`, `a78a03c3`, `03b8dd23`. Companion tiler: `04e6b7e`.
Backend tests: 1528; frontend units: 1387; tiler tests: 123; catalog browser cases: 3. Full browser suite remains red; live Azure import/rendering is not verified.
No publication to develop/main.

See [implementation report](review/implement-cloud-catalog/report.md) for commands,
local URLs, review findings and remaining acceptance work.
