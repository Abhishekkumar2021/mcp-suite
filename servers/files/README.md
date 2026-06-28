# @abhishekmcp/files

A robust, **sandboxed** filesystem [MCP](https://modelcontextprotocol.io) server. Gives any MCP client
(Claude Desktop, Claude Code, Cursor, …) safe, capable access to files within directories you allow —
read, search, edit, organize, archive — with a security-first design. Pure JavaScript, no native
dependencies, no API keys.

## Features

### Read & navigate
- `read_file` — read text with optional `head`/`tail` or a 1-based line window (pagination + truncation flag)
- `read_media` — read images/audio/binary as base64 (returned as an image/audio block when possible)
- `read_multiple` — batch-read several files
- `stat` — metadata (type, size, timestamps, mode); does not follow a final symlink
- `list_dir` — directory listing with type + size, sortable, paginated
- `tree` — recursive directory tree (depth-capped)
- `changed_since` — files modified after a timestamp (poll-based change detection)
- `list_roots` — the allowed sandbox roots

### Search
- `find_files` — glob search (`**/*.ts`), excludes `node_modules`/`.git` by default
- `search_content` — content grep (substring or regex) with context lines; skips binaries

### Integrity
- `file_hash` — sha256/sha1/md5 checksum
- `find_duplicates` — duplicate files by size then sha256
- `list_archive` — list a `.zip`'s contents without extracting

### Edit & write (token-efficient)
- `write_file` — create/overwrite (atomic; no-clobber unless `overwrite`)
- `edit_file` — replace a **unique** `oldText` with `newText` (refuses ambiguous matches); `dryRun` shows a unified diff
- `edit_lines` — replace a line range, optionally guarded by a content hash (`expectedHash`) to reject stale edits

### Organize
- `create_dir`, `move`, `copy` (recursive)
- `delete` — **soft-delete to trash** (recoverable), `list_trash`, `restore`, `empty_trash`
- `zip` / `unzip` — archives (zip-slip protected)

Every destructive tool supports `dryRun` to preview before committing.

## Configuration

| Variable | Required | Effect |
|----------|----------|--------|
| `FS_ROOTS` | **yes** | Allowed root directories, comma-separated. The server refuses to start without it. |
| `FS_READONLY` | no | `1`/`true` registers only read tools (safe sharing). |
| `FS_ALLOW_SECRETS` | no | `1`/`true` disables the secret denylist (see below). |
| `FS_AUDIT_LOG` | no | Path to append a JSON-lines audit record of every mutation. |
| `FS_OP_TIMEOUT_MS` | no | Per-operation timeout (default 30000). |
| `FS_MAX_CONCURRENCY` | no | Max concurrent tool executions (default 8). |

### Secret protection
By default the server **blocks reads of, and hides from discovery,** files that commonly hold secrets:
`.env`, `*.pem`, `*.key`, `id_rsa*`, `.ssh/**`, `.aws/**`, `.npmrc`, `credentials`, and more. Add your
own patterns in a per-root **`.mcpignore`** (gitignore syntax). Set `FS_ALLOW_SECRETS=1` to disable.

### Production hardening
Every mutation is timestamped to `FS_AUDIT_LOG` (if set) and stderr. All ops run under a concurrency
limit + per-op timeout. Reads stream (head reads and hashing never load whole files), and edits
**preserve line endings** (a CRLF file stays CRLF) and BOMs. The server ships with a committed
`node:test` suite (unit tests for the sandbox + integration/security tests) run in CI.

## Security

The whole design is sandbox-first:
- Every path is confined to `FS_ROOTS`, checked **both lexically and via `realpath`** — a symlink inside
  a root that points outside is rejected (on reads *and* writes).
- Writes/edits/deletes refuse to act **through** a symlink; writes are atomic (temp + rename).
- `unzip` is **zip-slip protected** (entries can't escape the destination).
- Size limits on reads, depth/result caps on tree/search/copy, control-char/`..` rejection.
- Deletes are **soft** (moved to `.mcp-trash`) and restorable.

## Usage

### Claude Code — plugin

```
/plugin marketplace add Abhishekkumar2021/mcp-suite
/plugin install files
```

### Claude Code — manual

```bash
claude mcp add files --env FS_ROOTS=$HOME/projects -- npx -y @abhishekmcp/files
```

### Claude Desktop

```json
{
  "mcpServers": {
    "files": {
      "command": "npx",
      "args": ["-y", "@abhishekmcp/files"],
      "env": { "FS_ROOTS": "/absolute/path/to/allow" }
    }
  }
}
```

## License

MIT
