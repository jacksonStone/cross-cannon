#!/usr/bin/env bash
# Compatibility command: API and browser now ship together as one Rust release.
set -euo pipefail
exec "$(dirname "$0")/../deploy.sh" "$@"
