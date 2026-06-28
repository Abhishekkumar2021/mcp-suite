# github (Claude Code plugin)

Installs the [`@abhishekmcp/github`](https://www.npmjs.com/package/@abhishekmcp/github) MCP server —
search repos/code/issues, read repos/issues/PRs/files, list notifications, and create issues.

## Install

```
/plugin marketplace add Abhishekkumar2021/mcp-suite
/plugin install github
```

## Authentication

Two options (set the env var before launching Claude Code, or use the login tool):

- **Token (simplest):** `export GITHUB_TOKEN=<your PAT>` — a [Personal Access Token](https://github.com/settings/tokens).
- **OAuth device flow:** `export GITHUB_CLIENT_ID=<your OAuth App client id>`, then run the `github_login`
  tool (it prints a code + URL; authorize in the browser and run it again to finish). No client secret
  needed. See the [server README](https://github.com/Abhishekkumar2021/mcp-suite/tree/main/servers/github#readme).

Set `GITHUB_READONLY=true` to disable issue-creating/commenting tools.
