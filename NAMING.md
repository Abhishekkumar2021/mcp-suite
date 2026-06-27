# Server Naming Standard

Every server in this repo follows one consistent naming scheme. This keeps the
suite predictable for users and avoids npm name collisions.

## The scheme

| Thing | Convention | Example |
|-------|------------|---------|
| **npm package** | Scoped under `@abhishekmcp`: `@abhishekmcp/<slug>` | `@abhishekmcp/notes` |
| **Server slug** | short, lowercase, hyphenated **noun** for the domain — no `mcp`/`server` in it | `notes`, `github`, `spotify` |
| **Binary** | `mcp-<slug>` | `mcp-notes` |
| **Directory** | `servers/<slug>/` | `servers/notes/` |
| **Release tag** | `<slug>-v<semver>` | `notes-v0.2.0` |
| **Description** | starts with `MCP server for …` | `MCP server for local markdown notes` |

## Rules

1. **Scoped packages only.** All packages publish under the `@abhishekmcp` npm
   org. The scope makes names globally unique and groups the suite together — no
   more clashes with existing public names, and no 24-hour unpublish locks.
2. **The slug is the identity.** Pick the shortest clear noun for the domain.
   The `mcp-` prefix lives only in the *binary* name, never the slug or scope.
3. **One package per server.** Each `servers/<slug>/` has its own `package.json`
   with `name: "@abhishekmcp/<slug>"` and `bin: { "mcp-<slug>": "dist/index.js" }`.
4. **Release tags drive CD.** The publish workflow parses `<slug>-v<version>`
   from the GitHub Release tag to decide which package to publish.
5. **Versioning is per-server.** Each server has its own semver, bumped
   independently.

## Checklist for a new server

- [ ] Directory `servers/<slug>/`
- [ ] `package.json` → `name: "@abhishekmcp/<slug>"`, `bin: { "mcp-<slug>": "dist/index.js" }`
- [ ] `description` starts with `MCP server for …`
- [ ] `tsconfig.json` extends `../../tsconfig.base.json`
- [ ] `publishConfig: { "access": "public", "provenance": true }`
- [ ] `repository.directory` set to `servers/<slug>`
- [ ] Row added to the **Servers** table in the root `README.md`
- [ ] Server `README.md` documenting tools + config
- [ ] First release tagged `<slug>-v<version>`
