# Frontend refactoring backlog

Status: follow-up work identified during the annotation rebuild audit. These
items predate that rebuild unless explicitly marked as a user-facing defect.
They are documented here so performance and correctness regressions can be
fixed without silently losing the broader cleanup work.

## Campaign imagery model

Campaign editing maintains an approximately 834-line camelCase imagery model
and hand-written mapping layer alongside the generated snake_case API model
(`types.ts`, `draftSync.ts`, and `controller.ts`). Decide which model owns the
domain, then remove the parallel representation and conversion seams. Preserve
draft editing and validation behavior with characterization tests first.

## Review screen forks

`OpenModeReview` / `TaskModeReview` and their two distribution-map variants
contain roughly 2,085 duplicated lines. Extract the genuinely shared review
workflow and map behavior; keep mode-specific policy at explicit boundaries
instead of merging the screens mechanically.

## Task filtering

Review has a separate task-filter implementation from annotation's tested
`campaign/tasks.ts`. The two now agree about who is assigned - a claim is no
longer an assignment row, so neither can mistake one for the other - but the
confidence, flagged and task-set predicates are still written twice. Move both
consumers onto one core and add cross-surface contract tests.

## Shared presentation vocabulary

- Consolidate the 14 hand-written display-name fallback chains behind one
  helper with an explicit precedence order.
- Consolidate the three label-colour implementations so a label renders the
  same colour in campaign editing, annotation, and review.

## Colormap vocabulary (user-facing defect)

The campaign wizard and annotation legend expose non-overlapping colormap
sets. The wizard offers `blues`, `coolwarm`, `greys`, `spectral`, `terrain`, and
`ylgnbu`, which the annotation legend can fall back to greyscale for, while it
hides three maps the legend can render. Define one canonical colormap registry
used for editing, API validation, and rendering. Migrate stored names through
aliases rather than changing existing campaigns in place.

Recommended order: fix the colormap registry first, then task filtering,
display names/label colours, the imagery model, and finally the review forks.
