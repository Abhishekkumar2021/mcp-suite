# Task Completion

No linter/formatter/test runner. The bar a change must clear:

1. `npm run build` (or `-w servers/<slug>`) — clean `tsc`. CI runs exactly this on Node 18/20/22.
2. For a server change: run an ad-hoc stdio JSON-RPC smoke test (see `mem:suggested_commands`) covering changed tools + security checks (path traversal, symlink escape, readonly gating).

## Publish flow (release-tag-driven, OIDC — no NPM_TOKEN)
1. Bump version in `servers/<slug>/package.json` AND the `McpServer` version string in `index.ts`.
2. `git commit` + `git push`.
3. `gh release create <slug>-v<ver>` → `.github/workflows/publish.yml` parses slug from tag, builds + `npm publish --provenance --access public`.
4. `gh run watch <id> --exit-status`; verify `npm view @abhishekmcp/<slug> version`.

## OIDC publish gotchas (do NOT "fix")
- publish.yml must NOT set `setup-node` `registry-url` — it writes a token .npmrc that shadows OIDC and 404s.
- Provenance works only in CI; any manual `npm publish` needs `--provenance=false` + 2FA `--otp`.
- npmjs.com trusted-publisher config must match workflow filename exactly (`publish.yml`), Environment blank.

## Commit trailer
End commit messages with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
