from datetime import timedelta
from typing import Literal

# Per-user statuses on a task, derived from that user's annotation
ANNOTATION_TASK_STATUS_PENDING = "pending"
ANNOTATION_TASK_STATUS_DONE = "done"
ANNOTATION_TASK_STATUS_SKIPPED = "skipped"

# How long a soft claim stays active before considered stale
CLAIM_TTL_MINUTES = 30

# Task-level statuses (computed from all assignments/annotations)
TaskStatus = Literal["pending", "partial", "done", "skipped", "conflicting"]

TASK_STATUS_PENDING: TaskStatus = "pending"
TASK_STATUS_PARTIAL: TaskStatus = "partial"
TASK_STATUS_DONE: TaskStatus = "done"
TASK_STATUS_SKIPPED: TaskStatus = "skipped"
TASK_STATUS_CONFLICTING: TaskStatus = "conflicting"

# Embeddings related
EMBD_MIN_N_NEIGHBOURS = 5

# --- The changes poll: how one annotator picks up another's work -------------

# How many changed annotations one poll carries. Past this the client is told to
# refetch its tiles: catching up shape by shape would cost more than the render
# it saves.
CHANGES_LIMIT = 500

# Rows are stamped when their transaction runs, not when it commits, so a poll
# taken between the two would never see them again. Every poll re-reads this far
# back; ids are what the client merges on, so seeing one twice is free.
CHANGES_OVERLAP = timedelta(seconds=5)

# How far back a deletion stays readable. The client polls every 20s, so this
# only has to cover a page left open over a long weekend; a cursor older than it
# is answered with "refetch your tiles" instead.
DELETION_RETENTION = timedelta(days=7)
