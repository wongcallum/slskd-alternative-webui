#!/usr/bin/env bash
# Pushes the review's commits to bump-slskd and comments its summary.
set -euo pipefail
dir=${BUMP_SLSKD_DIR:-/tmp/bump-slskd}
. "$dir/review.env"
cd "$dir/worktree"
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
# Once this repository is public, these notify people or add events to other repositories' issues.
check_text() {
  local found
  found=$(sed -E 's/`[^`]*`//g' "$1" |
    grep -oP '(?<![[:alnum:]_.+-])@[[:alnum:]][[:alnum:]-]*|[[:alnum:]_.-]+/[[:alnum:]_.-]+#[0-9]+|github\.com/[^/\s]+/[^/\s]+/(issues|pull|discussions)/[0-9]+' |
    grep -vF -e "github.com/$repo/" -e "$repo#") || true
  if [ -n "$found" ]; then
    echo "$found" >&2
    echo "Not published: $2 mentions someone or another repository's issue or pull request" >&2
    exit 1
  fi
}

check_text "$dir/summary.md" "the summary"
check_text <(git log --format=%B origin/bump-slskd..) "a commit message"
if [ -n "$(git rev-list origin/bump-slskd..)" ]; then
  git push origin bump-slskd
fi
{
  printf 'https://github.com/slskd/slskd/compare/%s...%s\n\n' "$base" "$pin"
  cat "$dir/summary.md"
} | gh pr comment "$pr" --body-file -
