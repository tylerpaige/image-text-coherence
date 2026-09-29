#!/usr/bin/env bash
# Dump the local seeded `images` table and restore it into the remote
# Fly Managed Postgres database.
#
# Prerequisite (one-time, manual): create the Fly MPG cluster and enable the
# "Vector" extension from the Fly dashboard/API before running this.
#
# Usage:
#   LOCAL_DATABASE_URL=postgresql://... \
#   REMOTE_DATABASE_URL=postgresql://... \
#   ./db/push_to_remote.sh

set -euo pipefail

: "${LOCAL_DATABASE_URL:?Set LOCAL_DATABASE_URL}"
: "${REMOTE_DATABASE_URL:?Set REMOTE_DATABASE_URL}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Make sure the 'vector' extension is already enabled on the remote cluster."

DUMP_DIR="$(mktemp -d)"
DUMP_FILE="$DUMP_DIR/laion_images.dump"

echo "Dumping local 'images' table -> $DUMP_FILE"
pg_dump "$LOCAL_DATABASE_URL" -Fc -t images -f "$DUMP_FILE"

echo "Restoring into remote database"
pg_restore --clean --if-exists --no-owner --no-privileges -d "$REMOTE_DATABASE_URL" "$DUMP_FILE"

echo "Building HNSW index on remote"
psql "$REMOTE_DATABASE_URL" -f "$SCRIPT_DIR/create_index.sql"

rm -rf "$DUMP_DIR"
echo "Done."
