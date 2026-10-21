# Development changelog

## 2026-10-21 - Project-only catalogs

Removed organization catalog ownership and management to reduce scope. Catalogs
use project-admin permissions and a required project ID. The original unreleased
migration now creates project-only catalogs; the tiler contract is unchanged.
Moved the campaign cloud-catalog picker under Custom (other), alongside STAC and
XYZ choices. A focused browser case covers the new section and return navigation.
The cloud imagery card now has one top-right Manage button, which opens and scrolls
to project imagery settings; removed the Refresh action and repeated instructions.
Added catalog deletion with confirmation, including drafts without contacting the
tiler. Discovered files start selected, with a select/unselect-all control. The
date regex is above the list; Apply can select only matching files. Date rows now
use compact inputs with an Interval checkbox. Optional filename date extraction
starts collapsed, with a question-mark example.

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
Backend tests: 1528; frontend units: 1387; tiler tests: 123; catalog browser cases:
3. Full browser suite remains red; live Azure import/rendering is not verified.
No publication to develop/main.

See [implementation report](review/implement-cloud-catalog/report.md) for commands,
local URLs, review findings and remaining acceptance work.
