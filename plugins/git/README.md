# git (Claude Code plugin)

Installs the [`@abhishekmcp/git`](https://www.npmjs.com/package/@abhishekmcp/git) MCP server — inspect and
(optionally) modify local Git repositories: status, log, diff, file history, branches, and gated
stage/commit. Pure-JS (isomorphic-git); **no `git` binary required**.

## Install

```
/plugin marketplace add Abhishekkumar2021/mcp-suite
/plugin install git
```

## Required configuration

The server is sandboxed and **refuses to start without `GIT_ROOTS`** — the directory (or directories)
containing the repos it may access. Set it before launching Claude Code:

```bash
export GIT_ROOTS="$HOME/code"            # one dir
export GIT_ROOTS="$HOME/code,$HOME/work" # or several
```

Write tools (stage/commit/branch/checkout) are **off by default** — enable with `GIT_WRITABLE=1`. See the
[server README](https://github.com/Abhishekkumar2021/mcp-suite/tree/main/servers/git#readme).
