# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in any of these MCP servers, please
report it privately rather than opening a public issue.

Use GitHub's [private vulnerability reporting](https://github.com/Abhishekkumar2021/mcp-suite/security/advisories/new)
to disclose responsibly.

Please include:

- The affected server (e.g. `servers/notes`)
- A description of the vulnerability and its impact
- Steps to reproduce, if possible

We will acknowledge your report and work on a fix as quickly as we can.

## Scope

These servers run locally and are granted access to local resources (files,
APIs) by the user. Of particular interest are:

- Path traversal or sandbox-escape in filesystem access
- Injection via tool inputs
- Leaking secrets/credentials through logs or tool output
