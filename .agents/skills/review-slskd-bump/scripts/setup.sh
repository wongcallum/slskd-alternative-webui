#!/usr/bin/env bash
set -euo pipefail
dir=${BUMP_SLSKD_DIR:-/tmp/bump-slskd}
stop() {
  echo "$*" >&2
  exit 1
}
pin_of() { git show "$1:devenv.lock" | jq -r .nodes.slskd.locked.rev; }

pr=$(gh pr list --head bump-slskd --json number,isCrossRepository \
  --jq '[.[] | select(.isCrossRepository | not)][0].number // empty')
[ -n "$pr" ] || stop "No bump-slskd pull request is open"

git fetch -q origin
[ "$(git branch --show-current)" != bump-slskd ] || stop "The main checkout is on bump-slskd"
[ -z "$(git branch --list bump-slskd --no-merged origin/bump-slskd)" ] || stop "bump-slskd has unpushed commits"
git worktree prune
wt=$(git worktree list --porcelain |
  awk '/^worktree / { path = substr($0, 10) } $0 == "branch refs/heads/bump-slskd" { print path }')
if [ -n "$wt" ]; then
  [ "$wt" = "$dir/worktree" ] || stop "bump-slskd is checked out at $wt"
  git worktree remove "$wt" || stop "$wt has uncommitted changes"
fi
rm -rf "$dir"
git worktree prune

pin=$(pin_of origin/bump-slskd)
git clone -q https://github.com/slskd/slskd "$dir/slskd"
git -C "$dir/slskd" checkout -q --detach "$pin"
# The end of the range that the latest review comment covers.
from=$(gh pr view "$pr" --json comments --jq '[.comments[] | select(.authorAssociation == "OWNER") | .body
  | capture("^https://github[.]com/slskd/slskd/compare/(?<a>[0-9a-f]{7,40})[.]{3}(?<b>[0-9a-f]{7,40})")]
  | last | .b // empty')
from=${from:-$(pin_of origin/master)}
base=$(git -C "$dir/slskd" rev-parse -q --verify "$from^{commit}") || stop "slskd has no commit $from"
[ "$base" != "$pin" ] || stop "The pin, $pin, has been reviewed"
git -C "$dir/slskd" merge-base --is-ancestor "$base" "$pin" || stop "The base, $base, isn't an ancestor of the pin, $pin"
printf 'main=%q\npr=%s\npin=%s\nbase=%s\n' "$PWD" "$pr" "$pin" "$base" >"$dir/review.env"

git worktree add -q --track -B bump-slskd "$dir/worktree" origin/bump-slskd
cd "$dir/worktree"
devenv shell -- pnpm install --frozen-lockfile >"$dir/install.log" 2>&1 ||
  stop "pnpm install failed; see $dir/install.log"
echo "Pull request #$pr: review $base..$pin"
