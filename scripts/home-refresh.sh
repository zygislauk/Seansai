#!/bin/sh
# Refreshes the production database from this machine (specs/002-vercel-deploy/quickstart.md §5).
# Runs from its own clean checkout and on what is merged to main, so work in progress can't migrate
# or write production's data. Secrets stay in a private file outside the repository.
set -eu

cd "$(dirname "$0")/.."

if [ "$PWD" != "$HOME/.local/share/seansai-refresh" ]; then
  echo "Run this from its own checkout, ~/.local/share/seansai-refresh, not from $PWD" >&2
  exit 1
fi
# Assigned first, so set -e stops the script when git status itself fails.
changes=$(git status --porcelain)
if [ -n "$changes" ]; then
  echo "The checkout has local changes, so it is not what is on main" >&2
  exit 1
fi

git fetch --quiet origin main
target=$(git rev-parse origin/main)
if [ "$(git rev-parse HEAD)" != "$target" ]; then
  git checkout --quiet --detach "$target"
fi
# Recorded only after a complete install, so one cut short is tried again on the next run.
if [ "$(cat node_modules/.installed-commit 2>/dev/null || true)" != "$target" ]; then
  npm ci --silent --omit=dev --ignore-scripts --workspace @seansai/api --include-workspace-root
  echo "$target" > node_modules/.installed-commit
fi

export NODE_ENV=production
exec node --env-file="$HOME/.config/seansai/refresh.env" apps/api/src/refresh-now.ts "$@"
