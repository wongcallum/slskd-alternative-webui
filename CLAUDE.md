- This is a solo project, so don't preserve backward compatibility. Don't write i18n or accommodate for legacy clients either.
- Prefer using established dependencies over writing your own implementation.
- Tests run offline against real slskd instances the harness starts. What needs a Soulseek login runs against Soulfind,
  a local Soulseek server, with slskd instances as the peers. `tests/contract` checks the slskd behaviour the UI relies
  on, and `tests/ui` checks the pages in a browser. Don't mock slskd, and don't write unit or component tests.
- When the code comes to rely on a new fact about slskd, add a contract test for it if it can be checked offline, which
  includes anything slskd does when logged in to Soulfind.
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
