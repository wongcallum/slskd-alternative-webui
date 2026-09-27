- This is a solo project, so don't preserve backward compatibility. Don't write i18n or accommodate for legacy clients either.
- Prefer using established dependencies over writing your own implementation.
- Tests run offline against real slskd instances the harness starts. What needs a Soulseek login runs against Soulfind,
  a local Soulseek server, with slskd instances as the peers. `tests/contract` checks the slskd behaviour the UI relies
  on, and `tests/ui` checks the pages in a browser. Don't mock slskd, and don't write unit or component tests.
- Add a contract test only where the app's code branches or waits on a slskd behaviour (a state that ends a poll,
  a status it retries on, a field it keys by) and getting it wrong would break a feature's main path, and only if it can
  be checked offline, which includes anything slskd does when logged in to Soulfind. Values that are only displayed,
  copy that quotes slskd, rare paths and facts that explain what the app avoids stay in docs/facts.md without a test.
  `tests/ui` has one test per feature's main path. Prefer tightening an existing test to adding one.
- By default, write no comments. Comments are written when there is behaviour that would surprise a competent reader of the code.
- Read the docs instead of trusting your training knowledge.
- Throwaway scripts, screenshots and dumps go in `/tmp`.
- Read README.md, docs/design.md and docs/facts.md
- Browser checks: `playwright-core` with `executablePath: process.env.CHROMIUM`, run from the repo root as `node --input-type=module <<'EOF'`.
  Never run `playwright install`. If `$CHROMIUM` is unset, run under `devenv shell --`.
- Requests for the page must send `Accept: text/html`, or slskd returns the raw file.
- slskd variants: `devenv down` (a running manager ignores new config), then e.g. `devenv up -d -O processes.slskd.env.SLSKD_NO_AUTH:string true`.
- The dev Soulseek account is real. Never write a fake slskd or Soulseek server; Soulfind is a real server, pinned in
  `devenv.yaml`.
- Run `pnpm fmt` and `pnpm lint` before committing.
- Commit messages: a capitalised subject of about 50 characters with no trailing punctuation. Write the whole message in
  the imperative: "Fix bug", not "Fixed bug" or "Fixes bug". The subject is often enough; if not, add a blank line, then
  paragraphs hard-wrapped at 72 characters.
- To release, run `pnpm version <version>` (its default commit message is fine) and `git push --follow-tags`. Once the
  Test run on that commit passes, run `gh release create v<version> --verify-tag --generate-notes`, and the Release
  workflow attaches the build.
