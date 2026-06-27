# Contributing

Thanks for your interest in contributing! This repo is a collection of Model Context Protocol (MCP) servers, organized as an npm workspaces monorepo.

## Getting started

```bash
git clone https://github.com/Abhishekkumar2021/mcp-suite.git
cd mcp-suite
npm install      # installs deps for every workspace
npm run build    # builds every server
```

## Project layout

```
servers/
  <name>/
    src/           # TypeScript source
    package.json   # the server's own npm package (unique name)
    tsconfig.json  # extends ../../tsconfig.base.json
    README.md
```

## Adding a new server

> **Follow the [naming standard](NAMING.md).** All packages are scoped as `@abhishekmcp/<slug>`.

1. Create `servers/<name>/` with:
   - a `package.json` whose `name` is unique on npm (check with `npm view <name>`)
   - a `tsconfig.json` that `extends: "../../tsconfig.base.json"`
   - source under `src/`, with the entry point declared in `bin`
2. Run `npm install` at the root so the workspace links it.
3. Build with `npm run build -w servers/<name>`.
4. Add a row to the **Servers** table in the root `README.md`.
5. Include a `README.md` in the server folder documenting its tools and config.

## Development guidelines

- Keep stdout clean — it is the MCP transport. Log to **stderr** only.
- Validate and sandbox any filesystem or network access.
- Give every tool a clear `title`, `description`, and a Zod `inputSchema`.
- Mark mutating tools with the appropriate annotations (e.g. `destructiveHint`).

## Commit & PR process

1. Create a feature branch: `git checkout -b feat/<short-name>`.
2. Make sure `npm run build` passes (CI runs this on every PR).
3. Open a pull request describing the change. Fill out the PR template.

## Code style

- TypeScript, ES modules.
- Match the style of the surrounding code.

By contributing, you agree that your contributions will be licensed under the MIT License.
