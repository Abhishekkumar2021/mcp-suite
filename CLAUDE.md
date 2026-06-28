# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`mcp-suite` is an npm-workspaces monorepo of independent [Model Context Protocol](https://modelcontextprotocol.io) servers written in TypeScript (ES modules). Each server in `servers/<slug>/` is its own npm package (`@abhishekmcp/<slug>`), versioned and published independently, but shares root tooling (`tsconfig.base.json`, `@types/node`, `typescript`).

## Commands

```bash
npm install                      # install deps for all workspaces (run once at root)
npm run build                    # build (tsc) every server
npm run build -w servers/notes   # build one server
npm run clean                    # rm -rf servers/*/dist
```

There is **no test runner or linter** configured. CI (`.github/workflows/ci.yml`) only runs `npm run build` across Node 18/20/22 — a clean `tsc` is the bar a change must clear. Verify servers with an ad-hoc stdio JSON-RPC smoke test: spawn `node servers/<slug>/dist/index.js` with the relevant env, write newline-delimited JSON-RPC to stdin (`initialize` → `notifications/initialized` → `tools/list` / `tools/call`), and parse responses from stdout line-by-line.

## Hard constraints

- **stdout is the MCP transport.** Never `console.log` from a server — log to **stderr** (`console.error`) only. A stray stdout write corrupts the protocol stream.
- **No native dependencies.** Servers run via `npx @abhishekmcp/<slug>`, so anything requiring a native build (e.g. `better-sqlite3`) is off-limits. Prefer pure-JS libraries. (The `notes` server deliberately uses MiniSearch instead of SQLite/FTS5, and hand-rolls its frontmatter parser to avoid `js-yaml`/npm-audit noise.)
- **Module resolution is `Node16` ESM** (`tsconfig.base.json`, `"type": "module"`). Relative imports must carry the `.js` extension even though the source is `.ts`.

## Naming standard (enforced — see NAMING.md)

Every server: npm name `@abhishekmcp/<slug>`, binary `mcp-<slug>`, directory `servers/<slug>/`, release tag `<slug>-v<semver>`, description starting `MCP server for …`. The slug is a short lowercase noun with no `mcp`/`server` in it. Each server's `package.json` needs `publishConfig: { access: "public", provenance: true }` and `repository.directory: "servers/<slug>"`.

## Publishing / CD (non-obvious)

Publishing is **release-driven**: creating a GitHub Release with a tag `<slug>-v<version>` triggers `.github/workflows/publish.yml`, which parses the slug from the tag and publishes that one package. Typical flow:

```bash
git commit ... && git push
gh release create notes-v0.2.0 --title "notes v0.2.0" --notes "..."
gh run watch <run-id> --exit-status
npm view @abhishekmcp/notes version   # confirm
```

Auth is **npm Trusted Publishing (OIDC)** — no `NPM_TOKEN`. Gotchas baked into the workflow (don't "fix" them):
- Do **not** set `registry-url` on `setup-node` — it writes an `.npmrc` token stub that shadows the OIDC exchange and 404s the publish.
- Provenance only works in CI; any manual `npm publish` needs `--provenance=false` plus a 2FA `--otp`.
- The OIDC trusted-publisher config on npmjs.com must match the workflow filename exactly (`publish.yml`) with a blank Environment, or it fails silently.

## Server architecture: `notes` (the reference implementation)

`servers/notes/src/` is layered; `index.ts` is thin and everything below it is pure logic. When adding features, follow this separation:

- **`config.ts`** — all env + limits in one place: `NOTES_DIR` (default `~/notes`), `NOTES_READONLY=1`, `NOTES_NO_CACHE=1`, `MAX_FILE_BYTES`, `INDEX_VERSION` (bump to force a full cache rebuild on upgrade), `INDEX_FILENAME` (`.notes-index.json`).
- **`fsutil.ts`** — the security boundary: `validateName` (rejects control chars/absolute paths), `resolveSafe` (lexical **and** realpath/symlink containment within the notes dir), size-guarded `readRaw`, `atomicWrite` (temp file + rename), `listNoteFiles`. All filesystem access goes through here.
- **`parse.ts`** — dependency-free markdown parsing: hand-rolled frontmatter reader plus `extractHeadings`/`extractSection`/`extractWikiLinks`/`extractTags`/`extractTodos`, composed by `parseNote`.
- **`store.ts`** — the engine. Holds an in-memory MiniSearch index + a `perNote` metadata map (title/tags/outLinks/mtime/size), and is the **single source of truth synced on every mutation**. On startup `buildIndex()` loads the `.notes-index.json` cache and does an **incremental diff** against disk (re-parse only new/changed by mtime+size, drop deleted), full-rebuilding only when the cache is missing/unreadable/version-bumped. All CRUD ops (`createNote`/`appendNote`/`deleteNote`/`moveNote`) update the index, graph metadata, and cache together. `moveNote` also rewrites `[[wiki-links]]` pointing at the moved note across the vault.
- **`graph.ts`** — read-only queries derived from `store`'s metadata (backlinks, neighbors/BFS, shortest path, related-by-shared-links+tags, overview, broken links). Returns compact node refs (name + title), never note bodies, to stay token-cheap.
- **`tokenizer.ts` / `embed.ts` / `semantic.ts`** (v0.3 semantic search) — pure-WASM, no native deps. `tokenizer.ts` is a hand-rolled BERT WordPiece tokenizer; `embed.ts` is a **lazy** singleton that `await import("onnxruntime-web")` (so startup never loads WASM) and downloads all-MiniLM-L6-v2 quantized (~23 MB) once to `getModelDir()`; `semantic.ts` is a vector store mirroring `store.ts`'s cache+incremental-sync pattern (`.notes-embeddings.json`), doing brute-force cosine + optional RRF hybrid fusion with `store.searchNotes`. The model is only ever touched when `semantic_search` runs; a download/load failure returns a clean tool error and never takes the server down.
- **`extras.ts` / `prompts.ts`** (v0.4 QoL + Prompts primitive) — `extras.ts` holds daily-note, template instantiation (`{{var}}` substitution), `renameTag` (rewrites frontmatter + inline `#hashtags` vault-wide via `store.updateNoteRaw`), and `unlinkedMentions`. `prompts.ts` builds messages for the three MCP **prompts** (`weekly_review`/`summarize_note`/`daily_standup`) registered via `server.registerPrompt` — the second server primitive in use after tools. Note: MCP **sampling** is deprecated (SEP-2577), so server-side LLM synthesis is intentionally avoided; retrieval tools return context for the calling model.

Two cross-cutting rules this server models for any future server:
- **Read/write tool split:** when `NOTES_READONLY=1`, `index.ts` simply does not register the mutating tools, so they're absent from `tools/list`. Mirror this for any server with side effects.
- **Index built before serving:** `main()` `await`s `buildIndex()` *before* `server.connect(transport)`.

## Adding a new server

`servers/<slug>/` with its own `package.json` (`name`, `bin: { "mcp-<slug>": "dist/index.js" }`, `publishConfig`), a `tsconfig.json` that `extends: "../../tsconfig.base.json"`, source in `src/`, and a `README.md` documenting tools + config. Run `npm install` at root to link the workspace, then add a row to the Servers table in the root `README.md`. Give every tool a `title`, `description`, and Zod `inputSchema`; mark destructive tools with `annotations: { destructiveHint: true }`.
