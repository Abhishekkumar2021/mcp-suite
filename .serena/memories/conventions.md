# Conventions

## Naming standard (NAMING.md — enforced)
- npm package: `@abhishekmcp/<slug>`; slug = short lowercase noun, no `mcp`/`server` in it.
- binary: `mcp-<slug>`; directory: `servers/<slug>/`; release tag: `<slug>-v<semver>`.
- description starts with `MCP server for …`.
- per-server package.json needs: `publishConfig: {access:"public", provenance:true}`, `repository.directory: "servers/<slug>"`, `bin: {"mcp-<slug>": "dist/index.js"}`.
- versioning is per-server, bumped independently.

## Code
- TS strict, ESM; relative imports carry `.js` extension.
- Tools: give each a `title`, `description` (terse — tool defs cost tokens), zod `inputSchema`; mark destructive tools `annotations: {destructiveHint: true}`.
- Logging to stderr only (stdout = transport).
- Match surrounding code style; comment density follows neighbors.

## Server design patterns (modeled by notes)
- Read/write tool split: when a readonly env flag is set, simply don't register mutating tools (absent from `tools/list`).
- Build any index/state with `await` BEFORE `server.connect(transport)` in `main()`.
- Route all filesystem access through a hardened util layer (path validation + realpath/symlink containment + size guards + atomic temp-write+rename).
