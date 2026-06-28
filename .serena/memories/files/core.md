# files server — Core

`servers/files/` = `@abhishekmcp/files` (bin `mcp-files`). Sandboxed local filesystem MCP server. Second server in the suite. ~25 tools. Pure-JS (no native): deps `fast-glob`, `fflate`, `diff` (pinned `diff@9` — v6-8 had a low-sev DoS in parsePatch/applyPatch, which we don't use), `ignore` (for .mcpignore). Published 0.2.0 (0.1.0 was a MANUAL npm bootstrap — first publish of a new scoped pkg can't use OIDC trusted publishing; set up trusted publishing on npmjs.com after first publish).

## v0.2 production hardening
- `log.ts` — structured stderr logging + `audit()` appends JSON line to FS_AUDIT_LOG on every mutation (wired via `addWriteTool` in index.ts).
- `runtime.ts` — `guard(fn)` = concurrency semaphore (FS_MAX_CONCURRENCY, def 8) + per-op timeout (FS_OP_TIMEOUT_MS, def 30000). index.ts wraps ALL handlers: `addTool` (guard) for reads, `addWriteTool` (guard+audit) for writes.
- `encoding.ts` — decodeText (BOM utf8/utf16; throws on binary via NUL), encodeText (restore BOM + normalize to detected EOL), detectEol. edit.ts edits in LF space then re-encodes → CRLF/BOM preserved.
- `denylist.ts` — block-by-default secrets (.env, *.pem/*.key, .ssh/**, .aws/**, .npmrc, credentials…) + per-root .mcpignore (via `ignore` pkg). reads throw (assertNotDenied in read/edit/write), discovery filters (list/tree/find/search/zip/dedup). FS_ALLOW_SECRETS=1 disables.
- Streaming: read.ts head via readline early-stop (works on huge files; totalLines=-1); archive.ts hashFile streams.
- Tests COMMITTED: `servers/files/test/*.test.mjs` (node:test, zero dep) — sandbox unit, runtime unit, hardening integration. `npm test` = build + `node --test test/*.test.mjs`. CI `test` job runs `npm test --workspaces --if-present` (Node 20/22).

Env (v0.2): + FS_ALLOW_SECRETS, FS_AUDIT_LOG, FS_OP_TIMEOUT_MS, FS_MAX_CONCURRENCY.

## Layered src/ (sandbox-first; index.ts thin)
- `config.ts` — `getConfiguredRoots()` (FS_ROOTS, comma/`:`/`;`-split, ~-expand), `isReadOnly()` (FS_READONLY 1|true), MAX_FILE_BYTES (20MB), MAX_RESULTS (1000), MAX_DEPTH (32), TRASH_DIR (`.mcp-trash`), VERSION.
- `sandbox.ts` — SECURITY CORE. `setRoots`/`initRootsFromEnv`/`getRoots` (realpath-canonicalized). `resolveInside(p)` = validateName (NUL/control/len) + lexical containment in a root + realpath-of-nearest-existing-ancestor re-check (defeats in-sandbox symlinks pointing out). `ensureNotSymlink` (writes/edits/deletes refuse to act through a symlink). `atomicWrite` (temp+rename, ensureNotSymlink). `readBytes` (size guard). `displayPath` (relative to root).
- `read.ts` — readFile (head/tail/1-based line window + truncated), readMedia (base64+mime), stat (lstat, no-follow), listDir, tree (depth+node capped, skips symlinks+TRASH), changedSince (mtime poll).
- `search.ts` — findFiles (fast-glob, rejects `..`, followSymbolicLinks:false, re-checks containment), searchContent (streaming regex grep, skips binary via NUL sniff, context lines, maxMatches, default-excludes node_modules/.git/trash).
- `edit.ts` — writeFile (atomic, no-clobber unless overwrite; dryRun NEVER throws on clobber—previews), editFile (UNIQUE oldText match or error), editLines (range + optional sha256 expectedHash stale-guard). dryRun returns unified diff via `diff`.createPatch.
- `mutate.ts` — createDir, move (EXDEV→cp+rm fallback), copy (fs.cp recursive, dereference:false), del→trash (`<root>/.mcp-trash/<id>/<base>` + manifest.json), listTrash, restore(id), emptyTrash. All dryRun-aware.
- `archive.ts` — zip/unzip (fflate; unzip rejects `..`/absolute/zip-slip), listArchive, hashFile (sha256/sha1/md5), findDuplicates (size→sha256).
- `index.ts` — ~25 tools; writes omitted when FS_READONLY; startup REFUSES no roots (exit 1); `augmentFromClientRoots()` best-effort union from MCP roots after init (deprecated SEP-2577 + Claude Code buggy → guarded, never required).

## Env
FS_ROOTS (required, comma-separated dirs), FS_READONLY=1|true.

## Watch-outs
- MCP `roots` is DEPRECATED (SEP-2577) + Claude Code advertises but doesn't implement `roots/list` → FS_ROOTS is authoritative; never depend on roots.
- ripgrep rejected (native) → pure-JS fast-glob + streaming grep.
- Distribution mirrors notes: mcpName, `servers/files/server.json`, plugins/files/ + marketplace entry. CD auto-publishes npm+registry on `files-v<ver>` tag.
