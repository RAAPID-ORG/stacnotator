# Labelling policy

Who may label what in a campaign, and whose labels count toward task
completion. The policy replaces the old "open mode vs task mode" question:
every campaign supports both free exploration and task work, and the policy
controls access to each.

## The four axes

Each axis is an audience: a set of role kinds plus an optional list of
specifically selected members. Empty means "no one".

| axis                | controls                                                | allowed kinds                                      |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| `explore`           | who may create standalone (free-drawn) annotations      | admins, members, anyone                            |
| `unassigned_tasks`  | who may label tasks that have no assignment             | admins, authoritative, members, anyone             |
| `assigned_tasks`    | who may add labels to tasks assigned to someone         | assignees, admins, authoritative, members, anyone  |
| `complete_assigned` | whose labels count toward completing an assigned task   | assignees, admins, authoritative, members          |

`anyone` means any approved platform user, membership not required, and is
only valid while the campaign is public. Making a campaign private strips
`anyone` from all axes.

## Counting vs extra labels

Labels from users allowed to label but outside the completing audience are
saved as "extra": they never make a task done or conflicting, are shown with
a badge in the UI, and are exported with
`stacnotator_counts_toward_completion = false`. For unassigned tasks the
labelling audience and the counting audience are the same axis
(`unassigned_tasks`). Whether a label counts is evaluated dynamically from
the current policy and roles, never stored, so policy changes apply
retroactively to task status.

Review requirements follow the same rule: the number of review assignments on
a task sets how many counting review labels it needs, and any counting label
from a user other than the primary annotator satisfies a slot, not only the
assigned reviewers.

## Defaults

- explore, unassigned_tasks, assigned_tasks: members (public campaigns also
  add anyone)
- complete_assigned: assignees + admins + authoritative

New campaigns get these defaults unless the wizard's "Labelling access"
section is customized. Migration `z1labelpolicy` backfills existing
campaigns the same way, split by visibility, so migration day changes no
labelling access. The one semantic change for pre-policy campaigns: a
member's label on someone else's assigned task is now "extra" instead of
completing the task.

## Where things live

- Storage: `labelling_policy` JSONB on `data.settings`
  (`campaigns/models.py`), validated by `LabellingPolicy` in
  `campaigns/schemas.py`.
- Evaluation: pure core in `campaigns/policy.py` (`is_allowed`,
  `counts_toward_completion`); role context is built once per request from
  the campaign user list.
- Enforcement: 403s in `annotation/service.py` on every annotation-creating
  or updating path. The server is the authority; frontend gating (disabled
  Explore toggle, task notices) is UX only.
- Editing: campaign wizard and the settings "Labelling access" card, via
  `PATCH /campaigns/{id}/labelling-policy` (admin only).
