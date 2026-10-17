#!/usr/bin/env bash
set -euo pipefail
dir=${BUMP_SLSKD_DIR:-/tmp/bump-slskd}
. "$dir/review.env"
cd "$main"
git worktree remove --force "$dir/worktree"
git branch -D bump-slskd
rm -rf "$dir"
