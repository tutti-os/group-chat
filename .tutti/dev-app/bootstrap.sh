#!/usr/bin/env bash
set -euo pipefail

if [ -z "${TUTTI_APP_PORT:-}" ]; then
  echo "TUTTI_APP_PORT is required; Tutti owns local app port allocation." >&2
  exit 2
fi

if [ -z "${TUTTI_APP_NODE:-}" ]; then
  echo "TUTTI_APP_NODE is required; use the Tutti managed Node runtime." >&2
  exit 2
fi

export TUTTI_APP_HOST="${TUTTI_APP_HOST:-127.0.0.1}"

package_dir="${TUTTI_APP_PACKAGE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
export GROUP_CHAT_PROJECT_ROOT="$(cd "$package_dir/../.." && pwd)"

exec "$TUTTI_APP_NODE" "$package_dir/run-local-debug.mjs"
