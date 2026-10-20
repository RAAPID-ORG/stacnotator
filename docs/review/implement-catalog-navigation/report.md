# Catalog navigation simplification

Implemented locally in `d565144e`, with tests `0794a8a2` and synchronization correction
`9e9164ca`. No backend or database changes.

| Requested behavior | Result |
| --- | --- |
| Remove organization ownership choice from project creation | Owner inferred from project; request body checked by browser test |
| Organization tabs including Imagery | Details, Members, API keys, Imagery |
| Project imagery in Settings | Embedded above Delete project; removed Campaigns action |
| Preserve existing links and selected catalog | Legacy redirects and query preservation tested |
| Improve layout | Responsive form columns, wrapping catalog rows, empty states, scrollable organization tabs |
| Follow-up layout polish | Space below organization tabs; New catalog popup using existing Modal; removed organization-page guidance |

Gate: `BASE_URL=http://localhost:5173 npx playwright test catalog-navigation.spec.ts
cloud-catalog-import.spec.ts --workers=2 --reporter=line`: **8 passed**. Typecheck,
ESLint and Prettier on changed files passed. One implementation attempt.
The first run read headings before the tab transition completed; adding an
aria-selected wait fixed that test race without changing any behavioral assertion.

Live Chromium checks covered organization and project creation forms at 1440px and
390px. Narrow-screen runs completed without console/page/request errors or document
overflow. The first desktop diagnostic mistakenly counted requests cancelled by its
own page navigation; separate pages and waiting for network idle resolved the harness
issue. Screenshots are in session files `catalog-nav-*-390.png`.

Follow-up verification: the same eight cases pass after adding popup visibility
and project imagery-before-deletion assertions. Typecheck and scoped ESLint pass;
changed files were formatted with Prettier. Live checks at 390px and 1440px confirm
both owner pages show a fixed popup that cancels without creating a catalog,
organization spacing and project section order, with no console/page/request errors.
Screenshots: `catalog-polish-*.png` and `catalog-popup-*.png` in session files.

One reviewer: no reproduced Important findings, four code-inspection nits, one
existing limitation. Retained follow-ups:
- Project catalog rows no longer display their owner even though the server list
  can contain shared organization catalogs.
- Access-request empty text can appear before loading finishes or after a failed load.
- The wizard Manage link could scroll directly to the imagery section in Settings.
- Existing limitation: an organization catalog can be listed for reuse without the
  caller having permission to open its management screen.

These claims were not browser-reproduced during this pass. No second review or
unrelated annotation fixes were performed. Usage: see /usage.
The guidance-copy nit was removed with the sentence at the user's request.

Live pages:
- http://localhost:5173/organizations/1?tab=imagery
- http://localhost:5173/projects/1?tab=settings

The earlier cloud-import task still needs real Azure import/rendering acceptance
and resolution of its full-browser-suite failures; this UI gate does not replace it.
