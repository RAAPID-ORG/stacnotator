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
