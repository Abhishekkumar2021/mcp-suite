#!/usr/bin/env node
/**
 * @abhishekmcp/git — local Git MCP server (isomorphic-git, pure-JS).
 * Tool registration only; logic lives in repo.ts behind the sandbox. Write tools
 * are registered only when GIT_WRITABLE=1. Refuses to start without GIT_ROOTS.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION, isWritable } from "./config.js";
import { getRoots, initRootsFromEnv } from "./sandbox.js";
import * as repo from "./repo.js";

const server = new McpServer({ name: "mcp-git-server", version: VERSION });

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));
const fail = (err: unknown) => text(`Error: ${(err as Error).message}`);

const repoArg = z.string().describe("Path to a git repository (within GIT_ROOTS; default the first root)");
const limitArg = z.number().int().positive().max(1000).optional();

// --- Read tools (always) -------------------------------------------------

server.registerTool(
  "git_status",
  { title: "Git status", description: "Working-tree status: staged, unstaged, and untracked files + current branch.", inputSchema: { repo: repoArg } },
  async ({ repo: r }) => {
    try {
      return json(await repo.status(r));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "git_log",
  { title: "Git log", description: "Commit history (newest first). Optional ref, limit, and file path filter.", inputSchema: { repo: repoArg, ref: z.string().optional(), limit: limitArg, path: z.string().optional().describe("Only commits touching this file") } },
  async ({ repo: r, ref, limit, path }) => {
    try {
      return json(await repo.log(r, ref, limit, path));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "git_show",
  { title: "Show commit", description: "A commit's metadata + the files it changed (vs its first parent).", inputSchema: { repo: repoArg, oid: z.string().describe("Commit SHA (full or abbreviated) or ref") } },
  async ({ repo: r, oid }) => {
    try {
      return json(await repo.showCommit(r, oid));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "git_diff",
  {
    title: "Git diff",
    description: "Unified diff. No refs → working tree vs HEAD; one ref → that ref vs working tree; two refs → refA vs refB. Optional single-file filter.",
    inputSchema: { repo: repoArg, refA: z.string().optional(), refB: z.string().optional(), path: z.string().optional(), patch: z.boolean().optional().describe("Include line-level hunks (default true)") },
  },
  async ({ repo: r, refA, refB, path, patch }) => {
    try {
      const changes = await repo.diff(r, { refA, refB, filepath: path, patch });
      if (changes.length === 0) return text("No changes.");
      return text(changes.map((c) => `${c.type.toUpperCase()} ${c.path}${c.patch ? `\n${c.patch}` : ""}`).join("\n"));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "git_file_history",
  { title: "File history", description: "Commits that touched a specific file (follows the path).", inputSchema: { repo: repoArg, path: z.string(), limit: limitArg } },
  async ({ repo: r, path, limit }) => {
    try {
      return json(await repo.log(r, "HEAD", limit, path));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "read_file_at",
  { title: "Read file at ref", description: "Contents of a file at a given ref/commit (default HEAD).", inputSchema: { repo: repoArg, path: z.string(), ref: z.string().optional() } },
  async ({ repo: r, path, ref }) => {
    try {
      return text(await repo.readFileAtRef(r, path, ref));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_branches",
  { title: "List branches", description: "Local branches in the repo.", inputSchema: { repo: repoArg } },
  async ({ repo: r }) => {
    try {
      return text((await repo.listBranches(r)).join("\n") || "(none)");
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_tags",
  { title: "List tags", description: "Tags in the repo.", inputSchema: { repo: repoArg } },
  async ({ repo: r }) => {
    try {
      return text((await repo.listTags(r)).join("\n") || "(none)");
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "current_branch",
  { title: "Current branch", description: "The currently checked-out branch.", inputSchema: { repo: repoArg } },
  async ({ repo: r }) => {
    try {
      return text(await repo.currentBranch(r));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "search_log",
  { title: "Search commits", description: "Search commit messages for a substring.", inputSchema: { repo: repoArg, query: z.string(), limit: limitArg } },
  async ({ repo: r, query, limit }) => {
    try {
      const hits = await repo.searchLog(r, query, limit);
      return hits.length ? json(hits) : text(`No commits match "${query}".`);
    } catch (err) {
      return fail(err);
    }
  },
);

// --- Write tools (only when GIT_WRITABLE=1) ------------------------------

if (isWritable()) {
  server.registerTool(
    "git_stage",
    { title: "Stage file", description: "Stage a file (git add).", inputSchema: { repo: repoArg, path: z.string() } },
    async ({ repo: r, path }) => {
      try {
        return text(await repo.stage(r, path));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "git_unstage",
    { title: "Unstage file", description: "Unstage a file (reset its index entry to HEAD).", inputSchema: { repo: repoArg, path: z.string() } },
    async ({ repo: r, path }) => {
      try {
        return text(await repo.unstage(r, path));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "git_commit",
    {
      title: "Commit",
      description: "Create a commit from the staged changes. Author falls back to git config if name/email omitted.",
      inputSchema: { repo: repoArg, message: z.string(), name: z.string().optional(), email: z.string().optional() },
    },
    async ({ repo: r, message, name, email }) => {
      try {
        return json(await repo.commit(r, message, name, email));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "git_create_branch",
    { title: "Create branch", description: "Create a new branch (optionally check it out).", inputSchema: { repo: repoArg, name: z.string(), checkout: z.boolean().optional() } },
    async ({ repo: r, name, checkout }) => {
      try {
        return text(await repo.createBranch(r, name, checkout ?? false));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "git_checkout",
    { title: "Checkout", description: "Switch to a branch or commit (updates the working tree).", inputSchema: { repo: repoArg, ref: z.string() }, annotations: { destructiveHint: true } },
    async ({ repo: r, ref }) => {
      try {
        return text(await repo.checkout(r, ref));
      } catch (err) {
        return fail(err);
      }
    },
  );
}

// --- Startup -------------------------------------------------------------

async function main() {
  await initRootsFromEnv();
  if (getRoots().length === 0) {
    console.error("Fatal: no sandbox roots. Set GIT_ROOTS to one or more directories (comma-separated).");
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`mcp-git-server v${VERSION} running${isWritable() ? " (writable)" : " (read-only)"}. Roots: ${getRoots().join(", ")}`);
}

main().catch((err) => {
  console.error("Fatal error starting mcp-git-server:", err);
  process.exit(1);
});
