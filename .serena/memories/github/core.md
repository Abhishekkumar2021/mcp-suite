# github server — Core

`servers/github/` = `@abhishekmcp/github` (bin `mcp-github`). Third server; suite's FIRST auth/secrets server. Local stdio, `@octokit/rest` (pure-JS, audit-clean). ~16 tools. Published 0.1.0. Honest: GitHub ships an official larger server; this is a learning build.

## src/
- `config.ts` — VERSION, SCOPES ("repo read:org notifications"), DEVICE_CODE_URL/ACCESS_TOKEN_URL, getClientId (GITHUB_CLIENT_ID, public, no secret), getEnvToken (GITHUB_TOKEN|GITHUB_PERSONAL_ACCESS_TOKEN), getConfigDir (~/.config/mcp-github, XDG-aware), getAuthFile, isReadOnly (GITHUB_READONLY).
- `auth.ts` — THE centerpiece. `getToken()` resolution chain: env PAT → cached token (refresh if expired+refresh_token) → throw `NotAuthenticatedError`. `login(maxPollMs=50000)` hand-rolled device flow: 1st call (no live pending) requests device/code, saves pending, returns "instructions" (code+URL); 2nd call polls access_token w/ authorization_pending + slow_down handling, bounded by maxPollMs, returns "authorized"|"pending"|"error". Token cache `{token?,pending?}` written atomically with mode 0600 (+chmod), NEVER logged. `logout()` rm cache. `authSource()`.
- `gh.ts` — `octo()` builds `new Octokit({auth: await getToken()})` per call (picks up fresh login). Wrappers return TRIMMED objects (token-efficient): whoami, searchRepos/Code/Issues, getRepo, listIssues, getIssue(+comments), listPullRequests, getPullRequest, getFileContents (decodes base64; dir listing; 1MB cap), listNotifications, rateLimit, createIssue, addIssueComment.
- `index.ts` — ~16 tools; auth+read always; writes (create_issue, add_issue_comment) gated by isReadOnly. `fail()` maps NotAuthenticatedError → guidance, Octokit err.status → message (401 hint, 403+x-ratelimit-remaining:0 → reset time). No auth at startup.

## Env
GITHUB_TOKEN/GITHUB_PERSONAL_ACCESS_TOKEN (PAT, secret), GITHUB_CLIENT_ID (OAuth App client id for device flow), GITHUB_READONLY.

## Tests
`test/auth.test.mjs` (token resolution; device flow via MOCKED globalThis.fetch — authorize on 1st poll to avoid real 5s sleeps since interval defaults to 5 via `||5`; 0600 check) + `test/tools.test.mjs` (stdio: tools/list, readonly gating, unauth→guidance, login-without-client-id→setup msg). Real-API checks manual (need token), excluded from CI.

## Watch-outs / gotchas
- Device-flow interval: `Number(data.interval)||5` floors to 5s → tests must authorize on first poll or they sleep 5s+ per pending.
- `search.issuesAndPullRequests` is deprecated by GitHub (still works; tsc shows a hint).
- First publish of new scoped pkg needs trusted-publishing config OR manual `npm publish` bootstrap (same as notes/files). OAuth App registration for a shippable GITHUB_CLIENT_ID is a one-time human step; PAT path works without it.
