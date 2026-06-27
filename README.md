# mcp-servers

A collection of [Model Context Protocol](https://modelcontextprotocol.io) servers, built in TypeScript.

Each server lives in its own folder under `servers/` and publishes to npm as an independent package, while sharing tooling through an npm workspace.

## Servers

| Server | Description | Status |
|--------|-------------|--------|
| [`notes`](servers/notes) | Manage local markdown notes — search, create, link, read | ✅ Working |

_More on the way: a GitHub helper, a Spotify controller, and others._

## Development

This is an npm workspaces monorepo.

```bash
# install all dependencies (run once at the root)
npm install

# build every server
npm run build

# build a single server
npm run build -w servers/notes

# remove all build output
npm run clean
```

## Adding a new server

1. Create `servers/<name>/` with its own `package.json` (set a unique npm `name`) and `tsconfig.json` that `extends: "../../tsconfig.base.json"`.
2. Put source in `servers/<name>/src/`.
3. Run `npm install` at the root so the workspace picks it up.
4. Add a row to the table above.

## Publishing a server

```bash
npm publish -w servers/<name> --access public
```

## License

MIT
