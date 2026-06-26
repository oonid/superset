#!/usr/bin/env bash
# Start Superset API in dev mode inside Docker

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="superset-linux-dev"

if ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
  echo "Error: Image $IMAGE_NAME not found. Run ./docker/dev.sh first to build it."
  exit 1
fi

DOCKER_ARGS=(
  --rm -i
  --network host
  -v "$REPO_ROOT:/workspace"
  -v "superset-dev-root-nm:/workspace/node_modules"
  -v "superset-bun-cache:/root/.bun/install/cache"
)

[[ -t 0 ]] && DOCKER_ARGS+=(-t)

echo ">>> Starting Superset Web dev server..."
docker run "${DOCKER_ARGS[@]}" "$IMAGE_NAME" bash -c '
  set -e
  cd /workspace
  
  # --- bun install: skip if lockfile unchanged ---
  LOCKFILE=/workspace/bun.lockb
  STAMP=/workspace/node_modules/.bun-install-stamp
  LOCKFILE_HASH=$(sha256sum "$LOCKFILE" 2>/dev/null | cut -d" " -f1 || echo "none")

  if [ -f "$STAMP" ] && [ "$(cat $STAMP 2>/dev/null)" = "$LOCKFILE_HASH" ] && [ -d node_modules ]; then
    echo "--- Dependencies up to date, skipping bun install ---"
  else
    echo "--- Installing monorepo dependencies (verbose mode) ---"
    bun install --frozen --verbose
    echo "$LOCKFILE_HASH" > "$STAMP"
  fi
  
  echo "--- Starting API Server and Electric Proxy ---"
  bun --filter @superset/web --filter electric-proxy dev
'
