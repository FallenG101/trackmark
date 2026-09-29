#!/bin/zsh
set -eu
cd "$(dirname "$0")"
trackmark_node="$(command -v node || true)"
if [[ -z "$trackmark_node" ]]; then
  trackmark_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$trackmark_node" ]]; then
  echo 'Install Node.js 20 or newer, then run this launcher again.'
  exit 1
fi
exec "$trackmark_node" scripts/dev.mjs
