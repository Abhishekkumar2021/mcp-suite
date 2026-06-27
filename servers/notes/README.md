# @abhishekmcp/notes

An [MCP](https://modelcontextprotocol.io) server for managing local markdown notes. Lets any MCP client (Claude Desktop, Claude Code, Cursor, …) search, read, create, link, and organize notes in a folder on your machine.

## Features

**Tools**
- `list_notes` — list all notes, newest first
- `read_note` — read a note's contents
- `create_note` — create a new note (optional overwrite)
- `append_note` — append to a note (great for journals/logs)
- `delete_note` — delete a note
- `search_notes` — full-text search across all notes
- `get_backlinks` — find notes linking to a note via `[[wiki-link]]` syntax

**Resources**
- Every note is exposed as a `notes://<name>` resource.

All file access is sandboxed to the notes directory — paths that try to escape it are rejected.

## Install & build

```bash
npm install
npm run build
```

## Configuration

Set `NOTES_DIR` to choose where notes live (defaults to `~/notes`):

```bash
export NOTES_DIR="$HOME/my-notes"
```

## Connecting to a client

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "notes": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-suite/servers/notes/dist/index.js"],
      "env": { "NOTES_DIR": "/absolute/path/to/your/notes" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add notes --env NOTES_DIR=$HOME/notes -- node /absolute/path/to/mcp-suite/servers/notes/dist/index.js
```

## Publishing to npm

This package publishes automatically via GitHub Actions (Trusted Publishing / OIDC) when a
release tagged `notes-v<version>` is created. See the repo root for the CD workflow.

Once published, users can run it without cloning:

```json
{
  "mcpServers": {
    "notes": {
      "command": "npx",
      "args": ["-y", "@abhishekmcp/notes"],
      "env": { "NOTES_DIR": "/path/to/notes" }
    }
  }
}
```

## License

MIT
