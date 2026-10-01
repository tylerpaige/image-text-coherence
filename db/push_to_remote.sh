#!/usr/bin/env bash
# Dump the local seeded `images` table and restore it into the remote database.
#
# Reads the Kamal db accessory from config/deploy.yml and POSTGRES_PASSWORD
# from .env.production, opens an SSH tunnel to the accessory (bound to
# localhost on the server), and closes the tunnel on exit.
#
# pg_dump, pg_restore, and psql run inside the Compose `db` container so the
# client matches that server (Postgres 16). A newer client on the host, such as
# Homebrew libpq 18, writes SET commands the remote server rejects.
#
# Usage:
#   docker compose up -d db
#   ./db/push_to_remote.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

eval "$(python3 - "$ROOT_DIR" <<'PY'
import shlex
import sys
from pathlib import Path

root = Path(sys.argv[1])

def fail(message):
    print(f"echo {shlex.quote(message)} >&2", flush=True)
    print("exit 1", flush=True)
    raise SystemExit

def password():
    path = root / ".env.production"
    if not path.is_file():
        fail(".env.production is missing. Copy .env.production.example and fill in POSTGRES_PASSWORD.")
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "POSTGRES_PASSWORD" and value:
            return value
    fail("POSTGRES_PASSWORD is empty in .env.production.")

def deploy_db():
    path = root / "config" / "deploy.yml"
    host = port = user = database = None
    in_accessories = False
    in_db = False
    in_clear = False
    for raw in path.read_text().splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        key, _, value = raw.strip().partition(":")
        value = value.split("#", 1)[0].strip().strip('"').strip("'")
        if indent == 0:
            in_accessories = key == "accessories"
            in_db = False
            in_clear = False
            continue
        if not in_accessories:
            continue
        if indent == 2:
            in_db = key == "db"
            in_clear = False
            continue
        if not in_db:
            continue
        if indent == 4 and key == "host":
            host = value
        elif indent == 4 and key == "port":
            parts = value.split(":")
            port = parts[-2] if len(parts) >= 2 else parts[0]
        elif indent == 6 and key == "clear":
            in_clear = True
        elif in_clear and indent == 8 and key == "POSTGRES_USER":
            user = value
        elif in_clear and indent == 8 and key == "POSTGRES_DB":
            database = value
        elif in_clear and indent <= 6:
            in_clear = False
    missing = [
        name
        for name, val in (
            ("host", host),
            ("port", port),
            ("POSTGRES_USER", user),
            ("POSTGRES_DB", database),
        )
        if not val
    ]
    if missing:
        fail("config/deploy.yml is missing db accessory settings: " + ", ".join(missing))
    return host, port, user, database

server_ip, remote_port, pguser, pgdatabase = deploy_db()
pgpassword = password()
for name, value in (
    ("SERVER_IP", server_ip),
    ("REMOTE_PORT", remote_port),
    ("PGUSER", pguser),
    ("PGDATABASE", pgdatabase),
    ("POSTGRES_PASSWORD", pgpassword),
):
    print(f"{name}={shlex.quote(value)}")
PY
)"

if ! docker compose exec -T db pg_isready -U postgres -d image-text-coherence >/dev/null; then
  echo "Local db container is not ready. Start it with: docker compose up -d db" >&2
  exit 1
fi

LOCAL_PORT="$(python3 - <<'PY'
import socket
sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
)"

TUNNEL_PID=""
cleanup() {
  if [[ -n "${TUNNEL_PID}" ]]; then
    kill "$TUNNEL_PID" >/dev/null 2>&1 || true
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
  docker compose exec -T db rm -f /tmp/image-text-coherence.dump >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Opening SSH tunnel to ${SERVER_IP} (remote Postgres on 127.0.0.1:${REMOTE_PORT})"
ssh -N \
  -o ExitOnForwardFailure=yes \
  -o BatchMode=yes \
  -o ConnectTimeout=15 \
  -L "127.0.0.1:${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" \
  "root@${SERVER_IP}" &
TUNNEL_PID=$!

python3 - "$LOCAL_PORT" "$TUNNEL_PID" <<'PY'
import socket
import sys
import time

port = int(sys.argv[1])
pid = int(sys.argv[2])
deadline = time.time() + 15
while time.time() < deadline:
    try:
        socket.create_connection(("127.0.0.1", port), 0.2).close()
        raise SystemExit(0)
    except OSError:
        try:
            import os
            os.kill(pid, 0)
        except OSError:
            sys.stderr.write("SSH tunnel exited before it was ready.\n")
            raise SystemExit(1)
        time.sleep(0.1)
sys.stderr.write("SSH tunnel did not open.\n")
raise SystemExit(1)
PY

echo "Using the Postgres client inside the local db container:"
docker compose exec -T db pg_dump --version

echo "Checking the remote database through the tunnel"
docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
  psql -h host.docker.internal -p "$LOCAL_PORT" -U "$PGUSER" -d "$PGDATABASE" -c "SELECT 1" >/dev/null

echo "Dumping local 'images' table inside the db container"
docker compose exec -T db pg_dump -U postgres -d image-text-coherence -Fc -t images -f /tmp/image-text-coherence.dump

echo "Restoring into remote database"
echo "This may take upwards of 20 minutes..."
docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
  pg_restore --clean --if-exists --no-owner --no-privileges \
  -h host.docker.internal -p "$LOCAL_PORT" -U "$PGUSER" -d "$PGDATABASE" \
  /tmp/image-text-coherence.dump

echo "Building HNSW index on remote"
echo "This may take upwards of 20 minutes..."
{
  echo "SET max_parallel_maintenance_workers = 0;"
  echo "SET maintenance_work_mem = '2GB';"
  cat "$SCRIPT_DIR/create_index.sql"
} | docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
  psql -h host.docker.internal -p "$LOCAL_PORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f -

echo "Done."
