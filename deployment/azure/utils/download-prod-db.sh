#!/bin/bash
# Download the production database into the local dev DB. See download-db.sh.
exec "$(dirname "${BASH_SOURCE[0]}")/download-db.sh" prod
