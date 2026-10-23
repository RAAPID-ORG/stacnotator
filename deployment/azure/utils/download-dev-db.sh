#!/bin/bash
# Download the deployed dev database into the local dev DB. See download-db.sh.
exec "$(dirname "${BASH_SOURCE[0]}")/download-db.sh" dev
