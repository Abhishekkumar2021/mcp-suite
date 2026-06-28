# mcp-suite — Core

npm-workspaces monorepo of independent MCP servers (TypeScript, ESM). Each `servers/<slug>/` is its own npm package `@abhishekmcp/<slug>`, versioned + published independently; shares root tooling.

## Source map
- `servers/<slug>/src/` — server source; entry `index.ts` (`#!/usr/bin/env node`, declared in `bin`).
- `servers/notes/` — markdown notes server; the reference implementation. See `mem:notes/core`.
- `servers/files/` — sandboxed filesystem server (2nd server). See `mem:files/core`.
- `servers/github/` — GitHub API server, first auth/secrets server (3rd). See `mem:github/core`.
- `servers/git/` — local Git server via isomorphic-git (4th). See `mem:git/core`.
- `tsconfig.base.json` — shared TS config; each server's `tsconfig.json` extends it.
- `.github/workflows/{ci,publish}.yml` — CI = build only; publish = release-tag-driven OIDC. See `mem:task_completion`.
- `NAMING.md` — enforced naming scheme (slug/package/bin/tag). See `mem:conventions`.

## Project-wide invariants
- **stdout is the MCP transport.** Servers must log to stderr (`console.error`) only; never `console.log`.
- **No native dependencies.** Servers run via `npx`; pure-JS libs only (no better-sqlite3 etc.).
- ESM + Node16 resolution: relative imports must use `.js` extension in `.ts` source.

Domains: `mem:tech_stack`, `mem:suggested_commands`, `mem:conventions`, `mem:task_completion`, `mem:notes/core`.
