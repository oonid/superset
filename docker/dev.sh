#!/usr/bin/env bash
# Start Superset in dev mode (Electron + Vite hot-reload) inside Docker,
# forwarding the Electron window to the host X11 display.
#
# Usage:
#   ./docker/dev.sh                  # start dev (builds image if needed)
#   ./docker/dev.sh --rebuild-image  # force rebuild the Docker image first
#   ./docker/dev.sh --reinstall      # force bun install even if lockfile unchanged
#
# Prerequisites on the host:
#   - Docker running
#   - An X11 display (DISPLAY is set) — works with X11 or XWayland
#
# Node_modules are isolated in Docker named volumes so the Linux-ABI native
# modules never conflict with anything on your host.
#
# Subsequent runs are fast (~30s) because:
#   - bun install is skipped when bun.lockb hasn't changed (stamp check)
#   - Electron native deps are skipped when Electron version hasn't changed
#   - Packages and Electron binary are cached in named Docker volumes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="superset-linux-dev"
REBUILD_IMAGE=false
FORCE_REINSTALL=false

for arg in "$@"; do
  case "$arg" in
    --rebuild-image) REBUILD_IMAGE=true ;;
    --reinstall) FORCE_REINSTALL=true ;;
  esac
done

# Verify there's a display to forward to
if [ -z "${DISPLAY:-}" ]; then
  echo "Error: \$DISPLAY is not set. An X11 display is required."
  echo "If you're on Wayland, XWayland should provide :0 automatically."
  exit 1
fi

# Build the dev image if it doesn't exist yet or --rebuild-image was passed
if $REBUILD_IMAGE || ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
  echo ">>> Building Docker dev image ($IMAGE_NAME)..."
  docker build -t "$IMAGE_NAME" -f "$SCRIPT_DIR/Dockerfile.linux-dev" "$SCRIPT_DIR"
else
  echo ">>> Reusing existing Docker dev image. Pass --rebuild-image to refresh."
fi

# Allow the Docker container to connect to the host X11 server
xhost +local:docker 2>/dev/null || echo "Note: xhost not found — X11 auth may need manual setup."

# Build docker run args array
DOCKER_ARGS=(
  --rm -i
  # Networking: share host stack so localhost resolves to the same postgres/electric
  # ports that docker-compose starts, and so X11 socket access works cleanly
  --network host
  # Chrome sandbox needs user namespace support; SYS_ADMIN enables CLONE_NEWUSER
  --cap-add=SYS_ADMIN
  # Increase /dev/shm for Chromium (default Docker limit is 64 MB, too small)
  --shm-size=256m
  # X11 display forwarding
  -e DISPLAY="$DISPLAY"
  -v /tmp/.X11-unix:/tmp/.X11-unix
  # Source code (bind mount — your edits are visible inside immediately)
  -v "$REPO_ROOT:/workspace"
  # Isolate node_modules in named volumes (Linux-ABI compatible, not host's)
  -v "superset-dev-root-nm:/workspace/node_modules"
  -v "superset-dev-desktop-nm:/workspace/apps/desktop/node_modules"
  # Shared caches across dev and build containers
  -v "superset-bun-cache:/root/.bun/install/cache"
  -v "superset-electron-cache:/root/.cache/electron"
  # Env vars for the Electron app
  -e ELECTRON_NO_SANDBOX=1
  -e SUPERSET_WORKSPACE_NAME=dev
  -e NODE_ENV=development
  # Port defaults (electron.vite.config.ts reads these before Zod; must be explicit)
  -e DESKTOP_VITE_PORT=5173
  -e DESKTOP_NOTIFICATIONS_PORT=51741
  -e ELECTRIC_PORT=3100
  # Pass reinstall flag into the container
  -e FORCE_REINSTALL="$FORCE_REINSTALL"
)

# Mount Xauthority cookie if present (more secure X11 auth than xhost)
if [ -f "${XAUTHORITY:-$HOME/.Xauthority}" ]; then
  DOCKER_ARGS+=(
    -v "${XAUTHORITY:-$HOME/.Xauthority}:/root/.Xauthority:ro"
    -e XAUTHORITY=/root/.Xauthority
  )
fi

# Allocate a TTY only when running in an interactive terminal (allows Ctrl+C)
[[ -t 0 ]] && DOCKER_ARGS+=(-t)

echo ">>> Starting Superset dev environment (display: $DISPLAY)..."
echo "    Source: $REPO_ROOT"
echo ""

docker run "${DOCKER_ARGS[@]}" "$IMAGE_NAME" bash -c '
  set -e
  cd /workspace

  # --- bun install: skip if lockfile unchanged (saves ~12 min on re-runs) ---
  LOCKFILE=/workspace/bun.lockb
  STAMP=/workspace/node_modules/.bun-install-stamp
  LOCKFILE_HASH=$(sha256sum "$LOCKFILE" 2>/dev/null | cut -d" " -f1 || echo "none")

  if [ "$FORCE_REINSTALL" = "true" ]; then
    echo "--- Installing monorepo dependencies (forced) ---"
    bun install --frozen
    echo "$LOCKFILE_HASH" > "$STAMP"
  elif [ -f "$STAMP" ] && [ "$(cat $STAMP 2>/dev/null)" = "$LOCKFILE_HASH" ] && [ -d node_modules ]; then
    echo "--- Dependencies up to date, skipping bun install (lockfile unchanged) ---"
    echo "    Pass --reinstall to force a fresh install."
  else
    echo "--- Installing monorepo dependencies ---"
    bun install --frozen
    echo "$LOCKFILE_HASH" > "$STAMP"
  fi

  # --- Electron binary ---
  cd apps/desktop
  ELECTRON_INSTALL_JS=$(node -p "require.resolve('\''electron/install.js'\'')" 2>/dev/null)
  ELECTRON_DIR=$(dirname "$ELECTRON_INSTALL_JS")
  if [ ! -f "$ELECTRON_DIR/path.txt" ]; then
    echo "--- Downloading Electron binary (~120 MB, one-time only) ---"
    node "$ELECTRON_INSTALL_JS"
  fi

  # --- native deps: skip if Electron version unchanged ---
  ELECTRON_VERSION=$(node -p "require('\''./node_modules/electron/package.json'\'').version" 2>/dev/null || echo "unknown")
  NATIVE_STAMP=./node_modules/.electron-native-stamp

  if [ "$FORCE_REINSTALL" = "true" ]; then
    echo "--- Installing Electron native deps (forced) ---"
    bun run install:deps
    echo "$ELECTRON_VERSION" > "$NATIVE_STAMP"
  elif [ -f "$NATIVE_STAMP" ] && [ "$(cat $NATIVE_STAMP 2>/dev/null)" = "$ELECTRON_VERSION" ]; then
    echo "--- Native deps up to date for Electron $ELECTRON_VERSION ---"
  else
    echo "--- Installing Electron native deps (Electron $ELECTRON_VERSION) ---"
    bun run install:deps
    echo "$ELECTRON_VERSION" > "$NATIVE_STAMP"
  fi

  echo "--- Starting D-Bus session ---"
  eval $(dbus-launch --sh-syntax) || true

  echo "--- Launching Superset dev (Electron + Vite hot-reload) ---"
  echo "    The Electron window will open on your host display."
  echo "    Close the window and Ctrl+C to stop. Re-run ./docker/dev.sh to relaunch."
  echo ""
  # Run predev steps manually so we can pass --no-sandbox to Electron via --.
  # (bun run dev triggers predev automatically but gives no way to append
  # Electron flags; macOS-specific scripts are no-ops on Linux.)
  NODE_ENV=development bun run clean:dev
  bun run generate:icons
  bun run bundle:cli
  # Launch: -- passes everything after it directly to the Electron binary
  NODE_ENV=development NODE_OPTIONS=--max-old-space-size=8192 \
    ./node_modules/.bin/electron-vite dev --watch -- --no-sandbox
'
