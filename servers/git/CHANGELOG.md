# Changelog — @abhishekmcp/git

All notable changes to this server. Format based on [Keep a Changelog](https://keepachangelog.com).

## 0.2.0 — Remote operations
- **Remote tools (HTTPS):** `git_clone`, `git_fetch`, `git_pull` (fast-forward), `git_push` — gated by `GIT_WRITABLE`, with token auth via `GIT_TOKEN`/`GITHUB_TOKEN` (+ optional `GIT_USERNAME`). Plus `list_remotes` (read).
- Friendly error mapping (auth → "set GIT_TOKEN"; rejected push → "not a fast-forward") and token redaction in all error output.
- No new dependencies (isomorphic-git's `http/node` client). SSH not supported (HTTPS only).

## 0.1.0 — Initial release
- Local Git MCP server on **isomorphic-git** (pure-JS, no native deps, no `git` binary).
- **Read tools:** `git_status`, `git_log` (ref/limit/path), `git_show`, `git_diff` (working-tree/ref/ref-vs-ref, unified hunks via the `diff` lib), `git_file_history`, `read_file_at`, `list_branches`, `list_tags`, `current_branch`, `search_log`.
- **Write tools** (only when `GIT_WRITABLE=1`): `git_stage`, `git_unstage`, `git_commit`, `git_create_branch`, `git_checkout`.
- Sandboxed to `GIT_ROOTS` (realpath containment; symlink escapes rejected); refuses to start without roots.
- Committed `node:test` suite (builds a real repo via isomorphic-git, exercises every tool over stdio, plus write-gating + security).
- Not included: blame, remote ops (clone/fetch/push — need credentials, planned for later).
