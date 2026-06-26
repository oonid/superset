#!/usr/bin/env bash
# Start the Superset API (apps/api — Next.js) inside Docker.
#
# Usage:
#   ./docker/api.sh              # start API dev server
#   ./docker/api.sh --reinstall  # force bun install even if lockfile unchanged
#
# The API runs at http://localhost:3001
# Env vars are read from the root .env file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="superset-linux-dev"
FORCE_REINSTALL=false

for arg in "$@"; do
  case "$arg" in
    --reinstall) FORCE_REINSTALL=true ;;
  esac
done

if ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
  echo ">>> Docker image $IMAGE_NAME not found. Run ./docker/dev.sh first to build it."
  exit 1
fi

if [ ! -f "$REPO_ROOT/.env" ]; then
  echo ">>> .env not found. Run: cp .env.local.example .env"
  exit 1
fi

echo ">>> Starting Superset API at http://localhost:3001 ..."
echo ""

DOCKER_ARGS=(
  --rm -i
  --network host
  --name superset-api
  -v "$REPO_ROOT:/workspace"
  -v "superset-dev-root-nm:/workspace/node_modules"
  -v "superset-api-nm:/workspace/apps/api/.next"
  --env-file "$REPO_ROOT/.env"
  -e FORCE_REINSTALL="$FORCE_REINSTALL"
  -e NEXT_TELEMETRY_DISABLED=1
)

[[ -t 0 ]] && DOCKER_ARGS+=(-t)

docker run "${DOCKER_ARGS[@]}" "$IMAGE_NAME" bash -c '
  set -e
  cd /workspace

  # Skip bun install if lockfile unchanged
  LOCKFILE=/workspace/bun.lockb
  STAMP=/workspace/node_modules/.bun-install-stamp
  LOCKFILE_HASH=$(sha256sum "$LOCKFILE" 2>/dev/null | cut -d" " -f1 || echo "none")

  if [ "$FORCE_REINSTALL" = "true" ]; then
    echo "--- Installing monorepo dependencies (forced) ---"
    bun install --frozen
    echo "$LOCKFILE_HASH" > "$STAMP"
  elif [ -f "$STAMP" ] && [ "$(cat $STAMP 2>/dev/null)" = "$LOCKFILE_HASH" ] && [ -d node_modules ]; then
    echo "--- Dependencies up to date, skipping bun install ---"
  else
    echo "--- Installing monorepo dependencies ---"
    bun install --frozen
    echo "$LOCKFILE_HASH" > "$STAMP"
  fi

  echo "--- Starting API dev server at http://localhost:3001 ---"
  echo "    Ctrl+C to stop."
  echo ""
  cd apps/api
  exec bun run dev 2>&1
'
