#!/bin/sh
# Refreshes the production database from this machine (specs/002-vercel-deploy/quickstart.md §5).
# Runs from its own checkout and always on what is merged to main, so an unreviewed branch can never
# migrate or write production's data. Secrets stay in a private file outside the repository.
set -eu

cd "$(dirname "$0")/.."

git fetch --quiet origin main
if [ ! -d node_modules ] || [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  git checkout --quiet --detach origin/main
  npm ci --silent --omit=dev --workspace @seansai/api --include-workspace-root
fi

export NODE_ENV=production
exec node --env-file="$HOME/.config/seansai/refresh.env" apps/api/src/refresh-now.ts "$@"
