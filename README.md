<div align="center">

# 🧰 mcp-suite

**A collection of [Model Context Protocol](https://modelcontextprotocol.io) servers, built in TypeScript.**

[![CI](https://github.com/Abhishekkumar2021/mcp-suite/actions/workflows/ci.yml/badge.svg)](https://github.com/Abhishekkumar2021/mcp-suite/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-43853d.svg)](https://nodejs.org)

</div>

Each server lives in its own folder under [`servers/`](servers) and publishes to npm as an independent package, while sharing tooling through an npm workspace. Connect them to any MCP client — Claude Desktop, Claude Code, Cursor, and more.

## Table of contents

- [Servers](#servers)
- [Quickstart](#quickstart)
- [Connecting to a client](#connecting-to-a-client)
- [Development](#development)
- [Adding a new server](#adding-a-new-server)
- [Publishing](#publishing)
- [Contributing](#contributing)
- [License](#license)

## Servers

| Server | Description | Status |
|--------|-------------|--------|
| [`notes`](servers/notes) | Local markdown notes with ranked full-text **and semantic** search, tags, todos, and a `[[wiki-link]]` knowledge graph (backlinks, neighbors, paths, related notes) | ✅ Stable |

_More on the way: a GitHub helper, a Spotify controller, and others._

## Quickstart

```bash
git clone https://github.com/Abhishekkumar2021/mcp-suite.git
cd mcp-suite
npm install      # installs deps for every workspace
npm run build    # builds every server
```

## Connecting to a client

Each server's README has full configuration instructions. As an example, to use the **notes** server with Claude Code:

```bash
claude mcp add notes --env NOTES_DIR=$HOME/notes -- node "$(pwd)/servers/notes/dist/index.js"
```

Or with Claude Desktop (`claude_desktop_config.json`):

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

## Development

This is an [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) monorepo.

```bash
npm install                      # install all workspace dependencies (run once at the root)
npm run build                    # build every server
npm run build -w servers/notes   # build a single server
npm run clean                    # remove all build output
```

## Adding a new server

1. Create `servers/<name>/` with its own `package.json` (unique npm `name`) and a `tsconfig.json` that `extends: "../../tsconfig.base.json"`.
2. Put source in `servers/<name>/src/`.
3. Run `npm install` at the root so the workspace picks it up.
4. Add a row to the [Servers](#servers) table above.

All servers follow the [naming standard](NAMING.md) (`@abhishekmcp/<slug>`). See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## Publishing

Each server is published independently:

```bash
npm publish -w servers/<name> --access public
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md). Found a security issue? See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Abhishek
