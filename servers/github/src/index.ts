#!/usr/bin/env node
/**
 * @abhishekmcp/github — GitHub MCP server.
 * Tool registration only; auth lives in auth.ts, API calls in gh.ts. Write tools
 * are omitted when GITHUB_READONLY is set. No auth is required at startup —
 * tools return clear guidance if the user isn't authenticated yet.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION, isReadOnly } from "./config.js";
import { NotAuthenticatedError, authSource, login, logout } from "./auth.js";
import { audit, redact } from "./log.js";
import * as gh from "./gh.js";

const server = new McpServer({ name: "mcp-github-server", version: VERSION });

const text = (value: string) => ({ content: [{ type: "text" as const, text: redact(value) }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

function fail(err: unknown) {
  if (err instanceof NotAuthenticatedError) return text(err.message);
  const e = err as { status?: number; message?: string; response?: { headers?: Record<string, string> } };
  if (e?.status) {
    let msg = `GitHub API error ${e.status}: ${e.message}`;
    if (e.status === 401) msg += " — token invalid/expired; run github_login or check GITHUB_TOKEN.";
    const h = e.response?.headers;
    if (e.status === 403) {
      if (h?.["x-ratelimit-remaining"] === "0") {
        msg += ` — rate limit exceeded; resets at ${new Date(Number(h["x-ratelimit-reset"]) * 1000).toISOString()}.`;
      } else {
        const have = h?.["x-oauth-scopes"];
        msg += ` — forbidden; your token may lack the required scope${have ? ` (has: ${have})` : " (writes need 'repo')"}.`;
      }
    }
    return text(msg);
  }
  return text(`Error: ${(err as Error).message}`);
}

const owner = z.string().describe("Repository owner (user or org)");
const repo = z.string().describe("Repository name");
const stateEnum = z.enum(["open", "closed", "all"]).optional().describe("Filter by state (default open)");

// --- Auth tools (always) -------------------------------------------------

server.registerTool(
  "github_login",
  {
    title: "Log in to GitHub",
    description:
      "Authenticate via GitHub OAuth device flow. First call returns a code + URL to open; run it again after authorizing to finish. (Or set GITHUB_TOKEN to skip.)",
    inputSchema: {},
  },
  async () => {
    try {
      return text((await login()).message);
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "github_logout",
  { title: "Log out", description: "Clear the cached GitHub token.", inputSchema: {} },
  async () => {
    await logout();
    return text("Logged out (cached token cleared).");
  },
);

server.registerTool(
  "whoami",
  { title: "Who am I", description: "Show the authenticated GitHub user (and how the token was obtained).", inputSchema: {} },
  async () => {
    try {
      const me = await gh.whoami();
      return json({ ...me, auth_source: await authSource() });
    } catch (err) {
      return fail(err);
    }
  },
);

// --- Search --------------------------------------------------------------

server.registerTool(
  "search_repos",
  { title: "Search repositories", description: "Search GitHub repositories (GitHub search syntax).", inputSchema: { query: z.string(), limit: z.number().int().positive().max(100).optional() } },
  async ({ query, limit }) => {
    try {
      return json(await gh.searchRepos(query, limit));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "search_code",
  { title: "Search code", description: "Search code across GitHub (e.g. 'addEventListener repo:owner/name').", inputSchema: { query: z.string(), limit: z.number().int().positive().max(100).optional() } },
  async ({ query, limit }) => {
    try {
      return json(await gh.searchCode(query, limit));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "search_issues",
  { title: "Search issues/PRs", description: "Search issues and pull requests (GitHub search syntax).", inputSchema: { query: z.string(), limit: z.number().int().positive().max(100).optional() } },
  async ({ query, limit }) => {
    try {
      return json(await gh.searchIssues(query, limit));
    } catch (err) {
      return fail(err);
    }
  },
);

// --- Repos / issues / PRs (read) -----------------------------------------

server.registerTool(
  "get_repo",
  { title: "Get repository", description: "Repository metadata (stars, language, default branch, license).", inputSchema: { owner, repo } },
  async ({ owner, repo }) => {
    try {
      return json(await gh.getRepo(owner, repo));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_issues",
  { title: "List issues", description: "List a repo's issues (excludes PRs).", inputSchema: { owner, repo, state: stateEnum, limit: z.number().int().positive().max(300).optional() } },
  async ({ owner, repo, state, limit }) => {
    try {
      return json(await gh.listIssues(owner, repo, state ?? "open", limit));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "get_issue",
  { title: "Get issue", description: "An issue's details plus its first comments.", inputSchema: { owner, repo, number: z.number().int().positive() } },
  async ({ owner, repo, number }) => {
    try {
      return json(await gh.getIssue(owner, repo, number));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_pull_requests",
  { title: "List pull requests", description: "List a repo's pull requests.", inputSchema: { owner, repo, state: stateEnum, limit: z.number().int().positive().max(300).optional() } },
  async ({ owner, repo, state, limit }) => {
    try {
      return json(await gh.listPullRequests(owner, repo, state ?? "open", limit));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "get_pull_request",
  { title: "Get pull request", description: "A PR's details (diff stats, merged state, body).", inputSchema: { owner, repo, number: z.number().int().positive() } },
  async ({ owner, repo, number }) => {
    try {
      return json(await gh.getPullRequest(owner, repo, number));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "get_file_contents",
  { title: "Get file contents", description: "Read a file (decoded) or list a directory in a repo, at an optional ref.", inputSchema: { owner, repo, path: z.string(), ref: z.string().optional().describe("Branch, tag, or commit SHA") } },
  async ({ owner, repo, path, ref }) => {
    try {
      return json(await gh.getFileContents(owner, repo, path, ref));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_notifications",
  { title: "List notifications", description: "Your unread GitHub notifications.", inputSchema: { limit: z.number().int().positive().max(300).optional() } },
  async ({ limit }) => {
    try {
      return json(await gh.listNotifications(limit));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "rate_limit",
  { title: "Rate limit", description: "Your remaining GitHub API requests and reset time.", inputSchema: {} },
  async () => {
    try {
      return json(await gh.rateLimit());
    } catch (err) {
      return fail(err);
    }
  },
);

// --- Write tools (omitted when GITHUB_READONLY) --------------------------

if (!isReadOnly()) {
  server.registerTool(
    "create_issue",
    {
      title: "Create issue",
      description: "Open a new issue in a repository.",
      inputSchema: { owner, repo, title: z.string(), body: z.string().optional() },
      annotations: { destructiveHint: true },
    },
    async ({ owner, repo, title, body }) => {
      try {
        const r = await gh.createIssue(owner, repo, title, body);
        await audit({ tool: "create_issue", target: `${owner}/${repo}#${r.number}`, outcome: "ok" });
        return json(r);
      } catch (err) {
        await audit({ tool: "create_issue", target: `${owner}/${repo}`, outcome: "error", detail: (err as Error).message });
        return fail(err);
      }
    },
  );

  server.registerTool(
    "add_issue_comment",
    {
      title: "Comment on issue",
      description: "Add a comment to an issue or pull request.",
      inputSchema: { owner, repo, number: z.number().int().positive(), body: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ owner, repo, number, body }) => {
      try {
        const r = await gh.addIssueComment(owner, repo, number, body);
        await audit({ tool: "add_issue_comment", target: `${owner}/${repo}#${number}`, outcome: "ok" });
        return json(r);
      } catch (err) {
        await audit({ tool: "add_issue_comment", target: `${owner}/${repo}#${number}`, outcome: "error", detail: (err as Error).message });
        return fail(err);
      }
    },
  );
}

// --- Startup -------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`mcp-github-server v${VERSION} running${isReadOnly() ? " (read-only)" : ""}.`);
}

main().catch((err) => {
  console.error("Fatal error starting mcp-github-server:", err);
  process.exit(1);
});
