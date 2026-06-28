# Changelog — @abhishekmcp/notes

All notable changes to this server. Format based on [Keep a Changelog](https://keepachangelog.com).

## 0.4.1
- Added `mcpName` for the official MCP registry.
- `NOTES_READONLY` now accepts `true` as well as `1` (so the MCPB read-only checkbox works).

## 0.4.0 — Prompts + note-app quality-of-life
- **Prompts** primitive (slash-command workflows): `weekly_review`, `summarize_note` (with note-name autocomplete), `daily_standup`.
- New tools: `daily_note`, `list_templates` / `create_from_template` (`{{date}}`/`{{time}}`/`{{title}}` + custom vars), `rename_tag` (vault-wide), `unlinked_mentions`.

## 0.3.0 — Local semantic search
- `semantic_search` (+ `hybrid` mode) using all-MiniLM-L6-v2 run locally via WebAssembly (onnxruntime-web) — no native deps, no API keys.
- Hand-rolled BERT WordPiece tokenizer; embeddings cached in `.notes-embeddings.json`; lazy model download.

## 0.2.0 — Search + knowledge graph + hardening
- Ranked full-text search (MiniSearch): fuzzy, prefix, field filters, snippets.
- Tags + todos; wiki-link knowledge graph (backlinks, neighbors, shortest path, related notes, overview, broken links).
- Persisted index with incremental mtime/size sync; token-efficient I/O (outline, section/window reads, pagination).
- Security: symlink-safe sandbox, size limits, atomic writes, name validation, `NOTES_READONLY` mode.

## 0.1.0 – 0.1.1
- Initial release: list/read/create/append/delete/search notes + `[[wiki-link]]` backlinks. Automated OIDC publishing established.
