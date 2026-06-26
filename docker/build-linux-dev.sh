#!/usr/bin/env bash
# Build Superset as a Linux .deb (and AppImage) using Docker.
# Nothing is installed on the host — all build tools run inside the container.
# Output lands at: apps/desktop/release/
#
# Usage:
#   ./docker/build-linux.sh          # build .deb + AppImage
#   ./docker/build-linux.sh --rebuild-image  # force rebuild the Docker image first
#
# Caches (persist across builds for speed):
#   superset-root-node-modules       root monorepo node_modules
#   superset-desktop-node-modules    apps/desktop node_modules
#   superset-electron-cache          downloaded Electron binaries
#   superset-electron-builder-cache  electron-builder cache
#   superset-bun-cache               Bun package cache

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="superset-linux-builder"
OUTPUT_DIR="$REPO_ROOT/apps/desktop/release"
REBUILD_IMAGE=false

for arg in "$@"; do
  case "$arg" in
    --rebuild-image) REBUILD_IMAGE=true ;;
  esac
done

# Build (or reuse) the Docker build image
if $REBUILD_IMAGE || ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
  echo ">>> Building Docker image ($IMAGE_NAME)..."
  docker build -t "$IMAGE_NAME" -f "$SCRIPT_DIR/Dockerfile.linux-build" "$SCRIPT_DIR"
else
  echo ">>> Reusing existing Docker image ($IMAGE_NAME). Pass --rebuild-image to refresh."
fi

echo ">>> Building Superset for Linux..."
docker run --rm \
  -v "$REPO_ROOT:/workspace" \
  -v "superset-root-node-modules:/workspace/node_modules" \
  -v "superset-desktop-node-modules:/workspace/apps/desktop/node_modules" \
  -v "superset-bun-cache:/root/.bun/install/cache" \
  -v "superset-electron-cache:/root/.cache/electron" \
  -v "superset-electron-builder-cache:/root/.cache/electron-builder" \
  -e NODE_ENV=production \
  -e NEXT_PUBLIC_API_URL=http://localhost:3001 \
  -e NEXT_PUBLIC_WEB_URL=http://localhost:3000 \
  -e NEXT_PUBLIC_MARKETING_URL=http://localhost:3002 \
  -e NEXT_PUBLIC_ELECTRIC_URL=http://localhost:8787 \
  -e RELAY_URL=http://localhost:4734 \
  "$IMAGE_NAME" \
  bash -c "
    set -e
    cd /workspace

    echo '--- Installing monorepo dependencies ---'
    bun install --frozen --ignore-scripts

    cd apps/desktop

    echo '--- Installing Electron native deps ---'
    bun run install:deps

    echo '--- Cleaning dev artifacts ---'
    bun run clean:dev

    echo '--- Generating icons ---'
    bun run generate:icons

    echo '--- Compiling app (electron-vite) ---'
    bun run compile:app

    echo '--- Packaging (electron-builder) ---'
    bun run package -- --publish never --linux deb -c.productName=superset-dev -c.appId=sh.superset.dev.desktop -c.linux.artifactName='superset-dev-\${version}-\${arch}.\${ext}'
  "

echo ""
echo "Build complete. Output in $OUTPUT_DIR:"
ls -lh "$OUTPUT_DIR" 2>/dev/null || echo "(empty — build may have failed)"
