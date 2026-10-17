#!/usr/bin/env bash
set -euo pipefail
dir=${BUMP_SLSKD_DIR:-/tmp/bump-slskd}
cd "$dir/worktree"

for ref in origin/master origin/bump-slskd; do
  sha=$(git rev-parse "$ref")
  for i in $(seq 15); do
    # Runs awaiting approval never start on their own.
    id=$(gh run list -w Test -c "$sha" --json databaseId,conclusion \
      --jq '[.[] | select(.conclusion != "action_required")][0].databaseId // empty')
    [ -z "$id" ] || break
    if [ "$i" = 15 ]; then
      echo "No Test run on $ref ($sha) after 15 minutes" >&2
      exit 1
    fi
    sleep 60
  done
  gh run watch "$id" -i 60 >/dev/null
  gh run view "$id" --json conclusion,url --jq "\"$ref: \(.conclusion), \(.url)\""
  built=$(gh run view "$id" --log |
    sed -nE 's/^test \((pinned|minimum|release)\)\t.*Z slskd ([0-9a-f]{40}).*/\1 \2/p')
  while IFS=$'\t' read -r job name conclusion; do
    m=${name#'test ('} m=${m%')'}
    rev=$(awk -v m="$m" '$1 == m { print $2 }' <<<"$built")
    line="  $m: $conclusion, built slskd ${rev:-nothing}"
    if [ "$conclusion" != success ]; then
      gh run view "$id" --job "$job" --log-failed >"$dir/log-$id-$m.txt"
      line+=", log $dir/log-$id-$m.txt"
      if gh run download "$id" -n "playwright-report-$m" -D "$dir/report-$id-$m" 2>/dev/null; then
        line+=", report $dir/report-$id-$m"
      fi
    fi
    echo "$line"
  done < <(gh run view "$id" --json jobs --jq '.jobs[] | [.databaseId, .name, .conclusion] | @tsv')
done
