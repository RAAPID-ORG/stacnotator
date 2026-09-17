ROLE_USER = "user"
ROLE_ADMIN = "admin"

# Labelling agents (see src/agents) are annotator users of their own, marked by this
# issuer. They do the work of a member but are not one: member and address-book lists
# leave them out, while attribution (statistics, review, exports) keeps them.
AGENT_ISSUER = "agent"

# The terms currently in force, matching the version line in the terms document
# (frontend/src/features/legal/terms.md). Bumping this makes every user accept
# again before they can use the app, so bump it only for a real revision.
TERMS_VERSION = "2026-08-19"
