# Changelog — @abhishekmcp/files

All notable changes to this server. Format based on [Keep a Changelog](https://keepachangelog.com).

## 0.2.0 — Production hardening
- **Committed test suite** (`node:test`): unit tests for the security core + runtime guard, plus integration/security tests, run in CI.
- **Audit log** (`FS_AUDIT_LOG`) + structured stderr logging of every mutation.
- **Resilience**: per-operation timeout (`FS_OP_TIMEOUT_MS`) and concurrency cap (`FS_MAX_CONCURRENCY`).
- **Streaming + encoding**: head reads and hashing stream (no whole-file load); edits preserve line endings (CRLF/LF) and BOM; binary files return a clean error.
- **Secret denylist**: reads of (and discovery of) `.env`/`*.pem`/`.ssh/**`/etc. blocked by default, plus per-root `.mcpignore`; `FS_ALLOW_SECRETS=1` overrides.

## 0.1.0 — Initial release
- Sandboxed filesystem server with ~25 tools: read (head/tail/line-window), read_media, stat, list_dir, tree, changed_since; find_files (glob) + search_content (grep); file_hash, find_duplicates, list_archive; write/edit_file/edit_lines; create_dir, move, copy, delete→trash, restore, empty_trash; zip/unzip.
- Security: realpath-containment sandbox (`FS_ROOTS`), symlink-escape rejection on reads + writes, zip-slip protection, soft-delete trash, atomic writes, `FS_READONLY` mode. Pure-JS, no native deps.
