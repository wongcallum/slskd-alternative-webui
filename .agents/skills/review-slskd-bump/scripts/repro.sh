#!/usr/bin/env bash
set -euo pipefail
dir=${BUMP_SLSKD_DIR:-/tmp/bump-slskd}
cd "$dir/worktree"
input=github:slskd/slskd/$1
shift
# The override rewrites devenv.lock.
trap 'git checkout -q devenv.lock' EXIT
devenv --override-input slskd "$input" tasks run slskd:build
devenv --override-input slskd "$input" shell -- pnpm test "$@"
