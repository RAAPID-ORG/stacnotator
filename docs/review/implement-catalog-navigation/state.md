# Implement - catalog navigation

Scope: fixed catalog ownership, organization tabs, project Settings imagery section,
responsive embedded catalog UI, canonical links and old-route compatibility.
Branch: feature/158-cloud-catalog-import. Base: 92c7f8fd.
Gate: five new Playwright navigation cases plus three existing catalog import cases;
frontend typecheck, ESLint and Prettier on changed source.
Protected: frontend/e2e/catalog-navigation.spec.ts,
frontend/e2e/cloud-catalog-import.spec.ts, frontend/playwright.config.ts.
Baseline: five new cases fail for missing tabs, redirects and owner behavior.
Attempt: 1/3. One implementation worker and one read-only reviewer completed.
Final gate: GREEN, eight browser cases, typecheck, scoped ESLint and Prettier.
Live desktop and 390px organization/project forms verified; no page overflow.

## Acceptance
- Project creation posts only its project owner; no organization choice.
- Organization creation is available in its Imagery tab and posts its org owner.
- Existing organization management sections remain reachable through tabs.
- Project imagery lives under Settings, not the Campaigns action bar.
- Old catalog URLs preserve selected catalog while landing on the parent tab.
- Opening/creating a catalog preserves the active tab query.
- Existing admin visibility restrictions remain in force.
- Catalog form/list use the existing design system and fit narrow screens.
- New catalog opens in the existing modal; cancellation leaves creation unsaved.
- Organization tabs have space before content; project imagery precedes deletion.
- Project description omits the organization-page guidance sentence.

## Decisions
Use existing TabNavigator and URL query convention, not new navigation machinery.
Reuse one embedded catalog component in both owner pages; no backend contract change.
No unrelated annotation/browser baseline repairs or publication.
Test correction: wait for aria-selected before reading newly selected tab headings;
all original behavior assertions retained. Fingerprints re-recorded explicitly.
Review: no reproduced Important findings; four nits and one existing limitation
recorded in report.md. No additional review pass or feature expansion.
Usage: see /usage. Agent role defaults.
