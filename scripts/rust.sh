#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Use the isolated toolchain when present; normal installations use their own cargo.
if [[ -x "$PWD/.tmp/rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo" ]]; then
  export RUSTUP_HOME="$PWD/.tmp/rustup"
  export CARGO_HOME="$PWD/.tmp/cargo"
  export PATH="$RUSTUP_HOME/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
fi
exec cargo "$@"
