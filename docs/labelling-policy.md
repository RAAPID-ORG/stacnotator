# Labelling policy

Who may label what in a campaign, and whose labels count toward task
completion. The policy replaces the old "open mode vs task mode" question:
every campaign supports both free exploration and task work, and the policy
controls access to each. (The campaign `mode` field still exists, but only
as the default work mode the UI opens in.)

## The axes

Each axis is an audience: a set of role kinds plus an optional list of
specifically selected users (which may include non-members). Empty means
"no one".

| axis                | controls                                                | allowed kinds                                      |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| `explore`           | who may create standalone (free-drawn) annotations      | admins, members, anyone                            |
| `unassigned_tasks`  | who may label tasks that have no assignment             | admins, authoritative, members, anyone             |
| `assigned_tasks`    | who may add labels to tasks assigned to someone         | assignees, admins, authoritative, members, anyone  |
| `complete_assigned` | whose labels count toward completing an assigned task   | assignees, admins, authoritative, members          |
| `modify_others`     | who may edit or delete an annotation somebody else made | admins, authoritative, members                     |

An annotation's author may always change or delete their own, whatever
`modify_others` says; the axis is only about other people's. It never allows
`anyone`: undoing other people's work is not something a campaign opens to
the public, however public its labelling is.

`anyone` means any authenticated platform user, membership not required, and
is only valid while the campaign is platform-public (project visibility
`public`). Moving the project off `public` (to `organization` or `private`)
strips `anyone` from `explore`, `unassigned_tasks`, and `assigned_tasks`
(`complete_assigned` never allows `anyone` in the first place).

`members` means project members plus platform admins. For org-public
projects (visibility `organization`) it additionally includes active members
of the approved owning organization: they get member-level labelling access
without a membership row, but no roles (not admins, not authoritative).

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

Two special cases override assignment aggregation: a single counting
authoritative label marks the task done regardless of assignments and review
slots (submitting `is_authoritative` requires the project's
authoritative-reviewer flag, a 403 independent of the labelling axes), and a task
with no assignment rows is done as soon as any counting label exists (all
labels skipped means the task is skipped).

## Defaults

- explore, unassigned_tasks, assigned_tasks: members (public campaigns also
  add anyone)
- complete_assigned: assignees + admins + authoritative
- modify_others: admins

New campaigns get these defaults unless the wizard's "Labelling access"
section is customized. Migration `z1labelpolicy` backfilled existing
campaigns the same way, split by the campaigns' then-existing `is_public`
flag (project visibility arrived later); `aa6polback` re-backfills so every
campaign is guaranteed to carry a policy. The one semantic change for
pre-policy campaigns: a member's label on someone else's assigned task is
now "extra" instead of completing the task. Campaign duplication clones the
policy along with the settings row.

## Where things live

- Storage: `labelling_policy` JSONB on `data.settings`
  (`campaigns/models.py`), validated by `LabellingPolicy` in
  `campaigns/schemas.py`.
- Evaluation: pure core in `campaigns/policy.py` (`is_allowed`,
  `counts_toward_completion`). Enforcement builds the role context per call
  (`build_policy_context`); the read/export layer amortizes it via a role
  map built once per request (`annotation/completion.py`).
- Enforcement: 403s in `annotation/service.py` on annotation-creating paths;
  annotation updates gate on the `explore` axis. Deletion is not
  policy-gated (only the public-campaign ownership rule applies), and
  claiming a task is not policy-gated either. A claim is a lease held on the
  task itself (`annotation_tasks.claimed_by_user_id`), not an assignment, so
  picking a task out of the unassigned pool leaves it on the
  `unassigned_tasks` axis for everyone, however long it is held. The server
  is the authority; frontend gating (disabled Explore toggle, task notices)
  is UX only.
- Editing: campaign wizard and the settings "Labelling access" card, via
  `PATCH /campaigns/{id}/labelling-policy` (admin only). The PATCH replaces
  the whole policy (the four labelling axes required, `modify_others`
  optional and defaulting to admins); `anyone` on a non-public
  project is rejected (400).
