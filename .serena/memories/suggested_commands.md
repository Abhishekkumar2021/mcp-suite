# Suggested Commands

Run from repo root (`/Users/abhishek/Dev/mcp-suite`).

## Build / clean
- `npm install` — install all workspace deps (once at root).
- `npm run build` — tsc-build every server.
- `npm run build -w servers/<slug>` — build one server.
- `npm run clean` — `rm -rf servers/*/dist`.

## Verify a server (no test runner exists)
Ad-hoc stdio JSON-RPC smoke test: spawn `node servers/<slug>/dist/index.js` with env, write
newline-delimited JSON-RPC to stdin (`initialize` → `notifications/initialized` → `tools/list` /
`tools/call`), parse stdout line-by-line. (See session history for a reusable harness pattern.)

## Publish (see mem:task_completion for full flow)
- `gh release create <slug>-v<ver> --title ... --notes ...` triggers CD.
- `gh run watch <id> --exit-status`; `npm view @abhishekmcp/<slug> version`.

## Platform: Darwin
Standard BSD userland; no GNU-specific flags assumed. `perl -i -pe` used for control-char-safe edits.
