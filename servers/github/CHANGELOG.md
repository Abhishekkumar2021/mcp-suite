# Changelog — @abhishekmcp/github

All notable changes to this server. Format based on [Keep a Changelog](https://keepachangelog.com).

## 0.1.0 — Initial release
- GitHub MCP server with ~16 tools: auth (`github_login` device flow, `github_logout`, `whoami`),
  search (`search_repos`/`search_code`/`search_issues`), read (`get_repo`, `list_issues`, `get_issue`,
  `list_pull_requests`, `get_pull_request`, `get_file_contents`, `list_notifications`, `rate_limit`),
  and write (`create_issue`, `add_issue_comment`, gated by `GITHUB_READONLY`).
- **Authentication:** hand-rolled OAuth **device flow** (no hosted callback) + PAT fallback; tokens
  cached at `~/.config/mcp-github/auth.json` (`0600`), auto-refreshed, never logged.
- Pure-JS (`@octokit/rest`), trimmed token-efficient responses, rate-limit surfacing.
- Committed `node:test` suite (auth resolution + device-flow via mocked fetch; stdio tool/readonly/unauth tests).
