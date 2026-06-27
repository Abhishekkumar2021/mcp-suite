# Tech Stack

- Language: TypeScript (strict), ES modules (`"type": "module"`).
- tsconfig.base: target ES2022, module + moduleResolution **Node16**, strict, declaration + sourceMap.
- Package manager: npm workspaces (`workspaces: ["servers/*"]`). Node >=18 (CI matrix 18/20/22).
- MCP SDK: `@modelcontextprotocol/sdk` (^1.29) — `McpServer` + `StdioServerTransport`.
- Validation: `zod` (^3) for every tool `inputSchema`.
- notes server libs: `minisearch` (^7, pure-JS ranked search). No gray-matter/js-yaml (frontmatter hand-rolled to avoid npm-audit noise).
- No test framework, no linter/formatter configured.
