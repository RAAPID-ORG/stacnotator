# Cloud catalog follow-ups

| ID | Class | Evidence / remaining work |
| --- | --- | --- |
| CC158-1 | Nit: cleanup lifecycle | A replaced manifest uses a fresh collection ID, but the old ID is passed to the worker in memory. Restart/retry can lose cleanup context; a late remote batch can recreate old metadata after deletion. Persist retired IDs and make eventual cleanup recoverable. New verified datasets remain isolated. |
| CC158-2 | Nit: deletion race | Review identified check/network/delete gaps and project/org cascade cleanup. No end-to-end failing reproduction. Add concurrency/lifecycle tests before changing these paths. |
| CC158-3 | Manual verification | Exercise a real Azure container/SAS, source changes, expiry and tile rendering. Automated Azure transport is faked. |
| CC158-4 | Feature follow-up | Used catalogs currently reject SAS replacement. Add revoke/re-register handling before supporting in-place credential rotation. |
| CC158-5 | Coverage | Real campaign save/reload and preset-copy integration is code-reviewed and covered indirectly, not by a complete live Azure campaign browser walkthrough. |
| CC158-6 | Operator metadata | Organization tiler API exposes names, not managed-import capabilities. Import checks support on the server; organization selection cannot pre-filter unsupported names. |
| CC158-7 | Release gate | Full browser run: 300 passed, 15 failed, 17 skipped. Baseline comparisons reproduced annotation label/escape/timeline, keyed-tile and chart-menu failures. Other failures were intermittent. Catalog-list wizard crash was fixed; focused source-save and all three catalog cases pass. Full browser gate still needs resolution before publication. |

S3, automatic regional tiler choice, native GCS, and catalog replication remain
separate future work; they were not part of the Azure implementation.
