---
name: review-slskd-bump
description: Review the open "Bump slskd" pull request, push fixes and comment a summary.
---

Run the scripts in `scripts/` next to this file from the main checkout. They keep everything outside the repository in
`/tmp/bump-slskd`. If one other than `repro.sh` fails, stop: say why, and skip every later step, clean-up included.
Don't push or comment; `publish.sh` does (step 6). Run `gh` only in the main checkout or the worktree, as in the slskd
clone it acts on slskd's repository.

## 1. Setup

Run `setup.sh`. It clones slskd at the pin, the slskd revision in bump-slskd's devenv.lock, into
`/tmp/bump-slskd/slskd`, and checks bump-slskd out at `/tmp/bump-slskd/worktree`. It prints the pull request's number,
the pin and the base: the end of the latest review comment's range (step 5), or with none, master's pin. Review the
range `<base>..<pin>`. Work and commit in the worktree, leaving the main checkout untouched. Only read the clone; run
nothing from it.

## 2. Fix test failures

- Run `checks.sh`. It waits for the Test runs on master and on bump-slskd, then prints each job's conclusion and the
  slskd revision it built, and where it saved each failed job's log and Playwright report.
- Reproduce a failure locally before changing anything, with `repro.sh <built revision> [<pnpm test arguments>]`,
  which builds that slskd and runs the worktree's tests against it. If a failure doesn't reproduce, pass its file and
  `--repeat-each 20`; narrow with `-g <title>` only once it does, as each repeat starts with fresh peers and earlier
  tests can be the cause.
- Find the cause:
  - `pinned`: the range, with `git log -p <base>..<pin> -- <paths>` in the clone.
  - `release`: the commits between its built revision and that of master's `release` job, if they differ; otherwise
    as for `minimum`.
  - `minimum`: its tag doesn't move, so not slskd. Compare with the same job in master's Test run: this pull request's
    other commits, or a flaky test.
- Handle it by cause:
  - Intended behaviour change: change the app to work on every supported version, and update the contract test and
    docs/facts.md to match.
  - Flaky or wrong test: fix the test to check the same behaviour at the same strictness.
  - slskd bug: leave the app alone and list the bug under "Needs a decision" with the upstream commit, for a human to
    report upstream or hold the pin.
  - slskd fails to build: list what it needs under "Needs a decision", such as another .NET SDK in `devenv.nix`
    (`dotnetCorePackages.combinePackages` holds several, so the minimum can still build).
  - slskd's startup or configuration changed: fix the harness in `tests/` for every supported version.
  - Soulfind lacks something the new slskd or Soulseek.NET sends: list it under "Needs a decision", naming any newer
    Soulfind commit that supports it.
  - Runner or network failure, with no test at fault: check that the job's tests pass with `repro.sh`.

## 3. Audit the range

- In the clone, each line of `git log --first-parent --oneline <base>..<pin>` is one change: a merge of an upstream
  pull request, a squash merge ending in `(#xxxx)`, or a direct commit. Cite a direct commit as `slskd/slskd@<sha>`
  with the sha from `git rev-parse --short=12`.
- Read each with `git diff <sha>^1 <sha>`, skipping tests and dependency lockfiles, never the whole range's diff, as
  pull requests can share a branch or merge master in. Where a change calls existing code in a new way, read that code
  in the clone too, since the diff can hide the behaviour. `src/web` is the stock UI; docs/facts.md describes it where
  the app copies or avoids it.
- If a change depends on Soulseek.NET, or `git diff <base>..<pin> -- src/slskd/slskd.csproj` changes the `Soulseek`
  package version, clone https://github.com/jpdillingham/Soulseek.NET into `/tmp/bump-slskd/soulseek-net` and read the
  version slskd pins (tags are bare versions), and for a new version `git diff <old>..<new> -- src`. `SN:` paths in
  docs/facts.md cite it.
- Give each change one or more verdicts:
  - Breaks: it changes a field, route or state that `src/` relies on (grep `src/` for them).
  - Stale fact: it makes docs/facts.md or docs/design.md wrong or incomplete, or adds something worth noting there.
  - slskd bug: it breaks something the app relies on, including a peer's behaviour, in a way the app can't work around.
    Handle it as in step 2.
  - No effect.
- For each new or changed behaviour that `src/` relies on or docs/facts.md states, and that the app could observe
  offline (through the REST API, the hubs or the files it lists), write a throwaway spec in `tests/contract`, run it
  with `repro.sh` against the pin and the base, and delete it. A difference between builds has no effect unless `src/`
  relies on it; a result that disagrees with docs/facts.md is a stale fact either way.

## 4. Make the edits

- Fix the app for each **breaks** verdict as in step 2, and correct docs/facts.md or docs/design.md for each
  **stale fact** verdict.
- Facts hold across every supported version, so qualify a version-dependent one with its upstream pull request (or
  direct commit): "Before x.xx.x (slskd#xxxx), ..." and "From x.xx.x (slskd#xxxx), ...", with the first release
  containing it, `git tag --contains <sha> --sort=v:refname | head -1` in the clone. With none yet, write
  "Up to <latest release>, ..." and "From slskd#xxxx (unreleased), ...".
- Find docs/facts.md's citations of slskd revisions that aren't releases with
  `grep -nwE 'unreleased|Up to|master|[0-9a-f]{7,40}' docs/facts.md`, leaving out other projects' revisions and commits
  cited as history. Where a release now contains the cited commit (for a pull request,
  `gh pr view <n> -R slskd/slskd --json mergeCommit --jq .mergeCommit.oid`; skip issues, such as slskd#1189), cite the
  release instead: "Before"/"From" for a change, and for a revision behaviour was checked at ("the same at master
  `xxxxxxx`"), the release, once you've checked it still holds at the pin.
- If the Soulseek.NET version changed, update the version docs/facts.md names in each fact that still holds.
- Commit one distinct change per commit, on top of the bump commit, without merging. Change only `src/`, `tests/` and
  `docs/`, and list a change needed elsewhere under "Needs a decision".
- If you made commits, run `repro.sh` on the last one against each revision bump-slskd's Test run built, and handle
  failures as in step 2.

## 5. Write the summary

Write the summary to `/tmp/bump-slskd/summary.md`. `publish.sh` comments it on the pull request after a
`https://github.com/slskd/slskd/compare/<base>...<pin>` link. A comment by the repository owner that starts with such a
link is a review comment, and the next review starts at the end of its range.

Cite upstream pull requests as `slskd#xxxx`, in the summary and in commit messages. Never write `<owner>/<repo>#xxxx`,
another repository's issue or pull request URL or an @mention, which `publish.sh` refuses, or a bare `#xxxx`, which
links to this repository. Give a change its own line if its verdict isn't No effect or a spec was run for it.

```markdown
**Tests:** passed / what failed, the cause, and the fix commit

**Changes**

- slskd#xxxx Title: what changed, then the verdict
- No effect: slskd#xxxx, slskd/slskd@xxxxxxxxxxxx, ...

**Edits:** each commit, with what it changes and why, or "N/A"

**Needs a decision:** anything left for a human (an upstream bug, a behaviour change with more than one sensible
fix, a minimum version bump), or "N/A". Carry over each item from this pull request's earlier review comments, with a
link to the comment, unless a later comment from the repository owner settles it.

**Verdict:** "not ready" if the tests fail on the last commit (in bump-slskd's Test run, or after commits of your own,
in `repro.sh`); otherwise "needs a decision" if an item under "Needs a decision" came in on this pull request (in any
of its reviews' ranges, not at master's pin); otherwise "ready to merge".
```

## 6. Publish

Show the user the summary and `git log --stat origin/bump-slskd..` in the worktree, and once they approve, run
`publish.sh` and `cleanup.sh`.
