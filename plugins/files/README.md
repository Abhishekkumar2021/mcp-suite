# files (Claude Code plugin)

Installs the [`@abhishekmcp/files`](https://www.npmjs.com/package/@abhishekmcp/files) MCP server — a
sandboxed local filesystem with read, search (glob + grep), token-efficient edits, copy/move,
soft-delete trash, zip, checksums, and duplicate detection.

## Install

```
/plugin marketplace add Abhishekkumar2021/mcp-suite
/plugin install files
```

## Required configuration

The server is sandboxed and **refuses to start without `FS_ROOTS`** — the directory (or directories)
it's allowed to touch. Set it in your environment before launching Claude Code:

```bash
export FS_ROOTS="$HOME/projects"          # one dir
export FS_ROOTS="$HOME/projects,$HOME/docs"  # or several, comma-separated
```

Set `FS_READONLY=true` to disable all file-modifying tools. See the
[server README](https://github.com/Abhishekkumar2021/mcp-suite/tree/main/servers/files#readme) for the
full tool list and security model.
