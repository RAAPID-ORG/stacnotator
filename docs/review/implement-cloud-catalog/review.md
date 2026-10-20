# Single review pass

Code auditor and security sentinel reviewed the core working diff from 310596a3
and companion tiler diff from 1ee0a87. The lead reran the supplied reproductions.

| Finding | Evidence | Disposition |
| --- | --- | --- |
| Swept live worker publishes an unverified import | Real Postgres reproduction yielded ready with no verified items | Fixed; regression pins failed state without retry |
| Managed campaign area change raises validation error | Real registration-spec construction failed on cc-* ID | Fixed; trusted internal reconstruction retains managed identity |
| Blob names with spaces are unreadable | Real raster HTTP read failed raw name and passed encoded name | Fixed; encoded hrefs map back to original object paths |
| Completion polling leaves stale list/settings | Browser reproduction showed Ready beside an Importing list row | Fixed; terminal polling invalidates detail/list |
| Org catalog reuse grants management to unrelated project admins | API regression reproduced unauthorized PATCH success | Fixed; separate use and creator/admin management |
| Generic query can name managed IDs | Schema/registration reproduction bypassed managed reference checks | Fixed; input query guard rejects managed namespace references |

Deployment follow-up was explicitly approved by the user: managed imports only
on private tilers, no need to retain the public STAC service if core does not
need it. The core path does not use that service. Runtime opt-in defaults off;
standalone Compose removes the public service; core optional tiler has none.

No second review pass was run. Nonblocking lifecycle and coverage limitations
are recorded in backlog.md rather than hidden by a passing test result.
