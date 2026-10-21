# Cloud catalog follow-ups

| ID | Class | Evidence / remaining work |
| --- | --- | --- |
| CC158-1 | Nit: cleanup lifecycle | A replaced manifest uses a fresh collection ID, but the old ID is passed to the worker in memory. Restart/retry can lose cleanup context; a late remote batch can recreate old metadata after deletion. Persist retired IDs and make eventual cleanup recoverable. New verified datasets remain isolated. |
| CC158-2 | Deletion lifecycle | Project deletion with an in-use catalog can fail: the project-to-catalog CASCADE meets the source-to-catalog RESTRICT before the campaign cascade removes the source. Project-only review reproduced the FK ordering with temporary PostgreSQL tables; the application delete path needs a regression and fix. The FK pairing predates the ownership reduction. Check/network/delete races also need coverage. |
| CC158-3 | Manual verification | Exercise a real Azure container/SAS, source changes, expiry and tile rendering. Automated Azure transport is faked. |
| CC158-4 | Feature follow-up | Used catalogs currently reject SAS replacement. Add revoke/re-register handling before supporting in-place credential rotation. |
| CC158-5 | Coverage | Real campaign save/reload and preset-copy integration is code-reviewed and covered indirectly, not by a complete live Azure campaign browser walkthrough. |
| CC158-6 | Removed scope | Organization catalog creation was removed; its tiler-selection limitation no longer applies. |
| CC158-7 | Release gate | Full browser run: 300 passed, 15 failed, 17 skipped. Baseline comparisons reproduced annotation label/escape/timeline, keyed-tile and chart-menu failures. Other failures were intermittent. Catalog-list wizard crash was fixed; focused source-save and all three catalog cases pass. Full browser gate still needs resolution before publication. |
| CC158-8 | Nit: page context | A user administering two projects can open one project's authorized catalog through the other's Settings URL by changing `?catalog=`. Check detail.project_id against the page project before displaying it. Code-inspection finding, not browser-reproduced. |

S3, automatic regional tiler choice, native GCS, and catalog replication remain
separate future work; they were not part of the Azure implementation.
