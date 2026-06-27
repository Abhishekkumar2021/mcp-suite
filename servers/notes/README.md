# @abhishekmcp/notes

An [MCP](https://modelcontextprotocol.io) server for managing local markdown notes. Lets any MCP client (Claude Desktop, Claude Code, Cursor, …) search, link, and organize the notes in a folder on your machine — with ranked full-text search, tags, todos, and a wiki-link knowledge graph.

Pure JavaScript, no native dependencies, no API keys — everything runs locally.

## Features

### Notes (token-efficient I/O)
- `list_notes` — list notes (newest first) with pagination (`offset`/`limit`) and an optional `tag` filter
- `read_note` — read a note; optionally just one heading's `section`, or a character window (`offset`/`limit`) with a truncation flag
- `get_outline` — return only a note's heading tree (grasp a big note in a few tokens)
- `create_note` — create a new note (optional `overwrite`)
- `append_note` — append to a note, creating it if missing (great for journals/logs)
- `delete_note` — delete a note
- `move_note` — rename/move a note **and rewrite every `[[wiki-link]]`** across the vault that points at it

### Search & discovery
- `search_notes` — ranked full-text search ([MiniSearch](https://github.com/lucaong/minisearch)); supports `fuzzy` and `prefix` matching, a `field` filter (`title`/`tag`/`body`/`path`), and returns ranked snippets with surrounding context
- `list_tags` — every tag across the vault with note counts
- `list_todos` — aggregate `- [ ]` / `- [x]` checkboxes across all notes

### Knowledge graph
- `get_backlinks` — notes linking to a note via `[[wiki-link]]` syntax
- `get_neighbors` — notes within N hops over the (undirected) link graph (depth/limit capped)
- `find_path` — shortest wiki-link chain between two notes
- `related_notes` — notes ranked by shared links + shared tags
- `graph_overview` — aggregate health: note/link/tag counts, top hubs, orphans, broken-link count
- `broken_links` — wiki-links that point at notes which don't exist

### Resources
- Every note is exposed as a `notes://<name>` resource.

### Frontmatter & tags
Notes may start with a YAML frontmatter block; `title` and `tags` (a list or comma-separated string) are recognized. Inline `#hashtags` in the body are also collected as tags.

```markdown
---
title: My Note
tags: [project, ideas]
---
# My Note
Links to [[another-note]]. Some inline #tag too.
```

## Configuration

All via environment variables:

| Variable | Default | Effect |
|----------|---------|--------|
| `NOTES_DIR` | `~/notes` | Directory where notes live (a leading `~` is expanded). |
| `NOTES_READONLY` | _unset_ | Set to `1` to disable all mutating tools (`create`/`append`/`delete`/`move` are not even registered) — safe for sharing a vault. |
| `NOTES_NO_CACHE` | _unset_ | Set to `1` to skip the on-disk index cache and rebuild in memory each start. |

### Index cache
For fast warm starts the server persists its search index to `<NOTES_DIR>/.notes-index.json` and, on startup, incrementally re-parses only the notes that changed (by mtime/size) since last run. The cache is rebuilt automatically if it's missing, unreadable, or from an older index version. Files on disk are always the source of truth.

## Security

All filesystem access is sandboxed to the notes directory:
- Path traversal (`../`) and absolute paths are rejected.
- Symlinks inside the vault that resolve outside it are rejected (realpath containment).
- Single files above a size limit are refused (DoS / context guard).
- Writes are atomic (temp file + rename), so a crash can't leave a torn note.

## Usage

### Claude Code

```bash
claude mcp add notes --env NOTES_DIR=$HOME/notes -- npx -y @abhishekmcp/notes
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "notes": {
      "command": "npx",
      "args": ["-y", "@abhishekmcp/notes"],
      "env": { "NOTES_DIR": "/absolute/path/to/your/notes" }
    }
  }
}
```

To share a vault read-only, add `"NOTES_READONLY": "1"` to `env`.

## Develop from source

```bash
npm install                      # from the repo root
npm run build -w servers/notes
node servers/notes/dist/index.js # NOTES_DIR=... to point at a vault
```

## Publishing to npm

Publishes automatically via GitHub Actions (Trusted Publishing / OIDC) when a release tagged `notes-v<version>` is created. See the repo root for the CD workflow.

## License

MIT
