# notes (Claude Code plugin)

Installs the [`@abhishekmcp/notes`](https://www.npmjs.com/package/@abhishekmcp/notes) MCP server as a
Claude Code plugin — local markdown notes with ranked + semantic search, tags, todos, a wiki-link
knowledge graph, daily notes, templates, and slash-command workflows.

## Install

```
/plugin marketplace add Abhishekkumar2021/mcp-suite
/plugin install notes
```

The server runs via `npx -y @abhishekmcp/notes` (Node 18+ required).

## Configuration

By default your notes live in `~/notes`. To point elsewhere, set `NOTES_DIR` in your environment
before launching Claude Code, e.g.:

```bash
export NOTES_DIR="$HOME/my-vault"
```

Other env vars: `NOTES_READONLY=true` (disable writes), `NOTES_MODEL_DIR` (semantic-search model
cache). See the [server README](https://github.com/Abhishekkumar2021/mcp-suite/tree/main/servers/notes#readme)
for the full tool + prompt list.
