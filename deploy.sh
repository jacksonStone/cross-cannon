#!/usr/bin/env bash
# Build off-server and activate one Rust process; never compile/install on production.
set -euo pipefail
cd "$(dirname "$0")"
exec python3 scripts/release-server.py "$@"
