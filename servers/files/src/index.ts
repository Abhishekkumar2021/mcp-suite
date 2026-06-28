#!/usr/bin/env node
/**
 * @abhishekmcp/files — a robust, sandboxed filesystem MCP server.
 * Tool registration only; all logic lives in the read/search/edit/mutate/archive
 * modules behind the sandbox. Write tools are omitted when FS_READONLY is set.
 *
 * Sandbox roots come from FS_ROOTS (required). The MCP `roots` protocol is
 * deprecated (SEP-2577) and unreliable across hosts, so it's only a best-effort
 * augment after connect — never the sole source.
 */
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION, isReadOnly } from "./config.js";
import { getRoots, initRootsFromEnv, setRoots } from "./sandbox.js";
import { changedSince, listDir, readFile, readMedia, stat, tree } from "./read.js";
import { findFiles, searchContent } from "./search.js";
import { editFile, editLines, writeFile } from "./edit.js";
import { copy, createDir, del, emptyTrash, listTrash, move, restore } from "./mutate.js";
import { findDuplicates, hashFile, listArchive, unzip, zip } from "./archive.js";
import { guard } from "./runtime.js";
import { audit } from "./log.js";

const server = new McpServer({ name: "mcp-files-server", version: VERSION });

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));
const fail = (err: unknown) => text(`Error: ${(err as Error).message}`);

type Handler = (args: any, extra?: any) => Promise<{ content: Array<Record<string, unknown>> }>;

/** Extract path-like fields from tool args for audit logging. */
function collectPaths(a: any): string[] {
  if (!a) return [];
  const out: string[] = [];
  for (const k of ["path", "source", "destination", "dest", "id"]) if (typeof a[k] === "string") out.push(a[k]);
  if (Array.isArray(a.sources)) out.push(...a.sources);
  if (Array.isArray(a.paths)) out.push(...a.paths);
  return out;
}

/** Register a tool, wrapping the handler with the concurrency+timeout guard. */
function addTool(name: string, def: unknown, handler: Handler): void {
  (server.registerTool as any)(name, def, async (args: any, extra: any) => {
    try {
      return await guard(() => handler(args, extra));
    } catch (err) {
      return fail(err);
    }
  });
}

/** Like addTool, but also writes an audit record (mutating tools). */
function addWriteTool(name: string, def: unknown, handler: Handler): void {
  (server.registerTool as any)(name, def, async (args: any, extra: any) => {
    let res;
    try {
      res = await guard(() => handler(args, extra));
    } catch (err) {
      res = fail(err);
    }
    const txt = String(res?.content?.[0]?.text ?? "");
    const errored = txt.startsWith("Error:");
    await audit({
      tool: name,
      paths: collectPaths(args),
      dryRun: !!args?.dryRun,
      outcome: errored ? "error" : "ok",
      detail: errored ? txt : undefined,
    });
    return res;
  });
}

// --- Read & search tools (always registered) -----------------------------

addTool(
  "list_roots",
  { title: "List roots", description: "List the sandbox root directories this server may access.", inputSchema: {} },
  async () => text(getRoots().join("\n") || "(no roots)"),
);

addTool(
  "read_file",
  {
    title: "Read file",
    description: "Read a text file. Optionally a head/tail (N lines) or a 1-based line window (offset/limit).",
    inputSchema: {
      path: z.string().describe("File path (absolute, or relative to the first root)"),
      head: z.number().int().positive().optional().describe("Return only the first N lines"),
      tail: z.number().int().positive().optional().describe("Return only the last N lines"),
      offset: z.number().int().positive().optional().describe("1-based start line for a window"),
      limit: z.number().int().positive().optional().describe("Max lines for the window"),
    },
  },
  async ({ path, head, tail, offset, limit }) => {
    try {
      const r = await readFile(path, { head, tail, offset, limit });
      const note = r.truncated
        ? r.totalLines >= 0
          ? `\n\n[showing ${r.returnedLines}/${r.totalLines} lines]`
          : `\n\n[showing first ${r.returnedLines} lines; file has more]`
        : "";
      return text(r.text + note);
    } catch (err) {
      return fail(err);
    }
  },
);

addTool(
  "read_media",
  {
    title: "Read media file",
    description: "Read an image/audio/binary file as base64 (returned as an image/audio block when possible).",
    inputSchema: { path: z.string().describe("File path") },
  },
  async ({ path }) => {
    try {
      const r = await readMedia(path);
      if (r.mimeType.startsWith("image/")) return { content: [{ type: "image" as const, data: r.base64, mimeType: r.mimeType }] };
      if (r.mimeType.startsWith("audio/")) return { content: [{ type: "audio" as const, data: r.base64, mimeType: r.mimeType }] };
      return text(`${r.mimeType}, ${r.bytes} bytes (base64):\n${r.base64}`);
    } catch (err) {
      return fail(err);
    }
  },
);

addTool(
  "read_multiple",
  {
    title: "Read multiple files",
    description: "Read several text files at once. Failures are reported inline and don't abort the batch.",
    inputSchema: { paths: z.array(z.string()).describe("File paths") },
  },
  async ({ paths }) => {
    const parts: string[] = [];
    for (const p of paths) {
      try {
        const r = await readFile(p);
        parts.push(`===== ${p} =====\n${r.text}`);
      } catch (err) {
        parts.push(`===== ${p} =====\n[error: ${(err as Error).message}]`);
      }
    }
    return text(parts.join("\n\n"));
  },
);

addTool(
  "stat",
  {
    title: "Stat",
    description: "File/directory metadata (type, size, timestamps, mode). Does not follow a final symlink.",
    inputSchema: { path: z.string().describe("Path") },
  },
  async ({ path }) => {
    try {
      return json(await stat(path));
    } catch (err) {
      return fail(err);
    }
  },
);

addTool(
  "list_dir",
  {
    title: "List directory",
    description: "List a directory's immediate children with type + size, sorted, paginated.",
    inputSchema: {
      path: z.string().describe("Directory path"),
      sortBy: z.enum(["name", "size", "mtime"]).optional().describe("Sort key (default name)"),
      limit: z.number().int().positive().max(5000).optional().describe("Max entries"),
    },
  },
  async ({ path, sortBy, limit }) => {
    try {
      const r = await listDir(path, { sortBy, limit });
      const rows = r.entries.map((e) => `${e.type === "dir" ? "d" : e.type === "symlink" ? "l" : "-"} ${String(e.size).padStart(10)}  ${e.name}`);
      const more = r.truncated ? `\n… ${r.total - r.entries.length} more` : "";
      return text(`${r.total} entr(ies):\n${rows.join("\n")}${more}`);
    } catch (err) {
      return fail(err);
    }
  },
);

addTool(
  "tree",
  {
    title: "Directory tree",
    description: "Render a recursive directory tree (depth-capped; does not follow symlinks).",
    inputSchema: {
      path: z.string().describe("Directory path"),
      depth: z.number().int().positive().max(32).optional().describe("Max depth (default 4)"),
      exclude: z.array(z.string()).optional().describe("Entry names to skip"),
    },
  },
  async ({ path, depth, exclude }) => {
    try {
      return text(await tree(path, { depth, exclude }));
    } catch (err) {
      return fail(err);
    }
  },
);

addTool(
  "changed_since",
  {
    title: "Changed since",
    description: "List files modified at/after an ISO timestamp (recursive poll-based change detection).",
    inputSchema: {
      path: z.string().describe("Directory to scan"),
      since: z.string().describe("ISO 8601 timestamp, e.g. 2026-06-01T00:00:00Z"),
    },
  },
  async ({ path, since }) => {
    try {
      const ms = Date.parse(since);
      if (Number.isNaN(ms)) return text(`Invalid timestamp "${since}".`);
      const r = await changedSince(path, ms);
      if (r.files.length === 0) return text("No files changed since then.");
      return text(`${r.files.length}${r.truncated ? "+" : ""} changed:\n${r.files.map((f) => `${f.mtime}  ${f.path}`).join("\n")}`);
    } catch (err) {
      return fail(err);
    }
  },
);

addTool(
  "find_files",
  {
    title: "Find files (glob)",
    description: "Find files/dirs by glob pattern within the sandbox. Excludes node_modules/.git by default.",
    inputSchema: {
      pattern: z.string().describe("Glob, e.g. '**/*.ts'"),
      cwd: z.string().optional().describe("Base directory (default first root)"),
      type: z.enum(["file", "dir", "any"]).optional().describe("Restrict to files or dirs"),
      exclude: z.array(z.string()).optional().describe("Extra ignore globs"),
      limit: z.number().int().positive().max(5000).optional(),
    },
  },
  async ({ pattern, cwd, type, exclude, limit }) => {
    try {
      const r = await findFiles(pattern, { cwd, type, exclude, limit });
      if (r.matches.length === 0) return text("No matches.");
      return text(`${r.matches.length}${r.truncated ? "+" : ""} match(es):\n${r.matches.join("\n")}`);
    } catch (err) {
      return fail(err);
    }
  },
);

addTool(
  "search_content",
  {
    title: "Search content (grep)",
    description: "Search file contents by substring or regex, with optional context lines. Skips binaries.",
    inputSchema: {
      query: z.string().describe("Text or regex to search for"),
      cwd: z.string().optional().describe("Base directory (default first root)"),
      include: z.string().optional().describe("Glob of files to search (default **/*)"),
      exclude: z.array(z.string()).optional().describe("Extra ignore globs"),
      regex: z.boolean().optional().describe("Treat query as a regular expression"),
      ignoreCase: z.boolean().optional(),
      context: z.number().int().min(0).max(5).optional().describe("Context lines around each hit"),
      maxMatches: z.number().int().positive().max(2000).optional(),
    },
  },
  async ({ query, cwd, include, exclude, regex, ignoreCase, context, maxMatches }) => {
    try {
      const r = await searchContent(query, { cwd, include, exclude, regex, ignoreCase, context, maxMatches });
      if (r.matches.length === 0) return text(`No matches (${r.filesScanned} files scanned).`);
      const lines = r.matches.map((m) => `${m.path}:${m.line}: ${m.text}`);
      return text(`${r.matches.length}${r.truncated ? "+" : ""} match(es) in ${r.filesScanned} files:\n${lines.join("\n")}`);
    } catch (err) {
      return fail(err);
    }
  },
);

addTool(
  "file_hash",
  {
    title: "File hash",
    description: "Compute a checksum of a file (sha256 default).",
    inputSchema: { path: z.string(), algo: z.enum(["sha256", "sha1", "md5"]).optional() },
  },
  async ({ path, algo }) => {
    try {
      return text(`${algo ?? "sha256"}  ${await hashFile(path, algo)}`);
    } catch (err) {
      return fail(err);
    }
  },
);

addTool(
  "find_duplicates",
  {
    title: "Find duplicates",
    description: "Find duplicate files under a directory (grouped by size then sha256).",
    inputSchema: { dir: z.string().describe("Directory to scan") },
  },
  async ({ dir }) => {
    try {
      const groups = await findDuplicates(dir);
      if (groups.length === 0) return text("No duplicates found.");
      return text(groups.map((g) => `# ${g.size} bytes (${g.hash.slice(0, 12)})\n${g.paths.map((p) => `  ${p}`).join("\n")}`).join("\n\n"));
    } catch (err) {
      return fail(err);
    }
  },
);

addTool(
  "list_archive",
  {
    title: "List archive",
    description: "List the entries in a .zip archive without extracting.",
    inputSchema: { path: z.string().describe("Path to a .zip file") },
  },
  async ({ path }) => {
    try {
      const entries = await listArchive(path);
      return text(`${entries.length} entr(ies):\n${entries.map((e) => `${String(e.bytes).padStart(10)}  ${e.name}`).join("\n")}`);
    } catch (err) {
      return fail(err);
    }
  },
);

addTool(
  "list_trash",
  {
    title: "List trash",
    description: "List soft-deleted items available to restore.",
    inputSchema: {},
  },
  async () => {
    const items = await listTrash();
    if (items.length === 0) return text("Trash is empty.");
    return text(items.map((i) => `${i.id}  ${i.deletedAt}  ${i.originalPath}`).join("\n"));
  },
);

// --- Mutating tools (omitted when FS_READONLY) ---------------------------

if (!isReadOnly()) {
  addWriteTool(
    "write_file",
    {
      title: "Write file",
      description: "Create or overwrite a file (atomic). Refuses to clobber unless overwrite:true. Supports dryRun.",
      inputSchema: {
        path: z.string(),
        content: z.string(),
        overwrite: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ path, content, overwrite, dryRun }) => {
      try {
        const r = await writeFile(path, content, { overwrite, dryRun });
        return text(dryRun ? `${r.message}\n\n${r.diff}` : r.message);
      } catch (err) {
        return fail(err);
      }
    },
  );

  addWriteTool(
    "edit_file",
    {
      title: "Edit file (find/replace)",
      description: "Replace a UNIQUE occurrence of oldText with newText. Use dryRun to preview the unified diff.",
      inputSchema: {
        path: z.string(),
        oldText: z.string().describe("Exact text to replace (must appear exactly once)"),
        newText: z.string(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ path, oldText, newText, dryRun }) => {
      try {
        const r = await editFile(path, oldText, newText, { dryRun });
        return text(`${r.message}\n\n${r.diff}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  addWriteTool(
    "edit_lines",
    {
      title: "Edit lines (range)",
      description: "Replace lines [startLine,endLine] (1-based, inclusive) with newContent. Pass expectedHash (from a prior read) to guard against stale edits. Supports dryRun.",
      inputSchema: {
        path: z.string(),
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
        newContent: z.string(),
        expectedHash: z.string().optional().describe("sha256 of the current range; rejects stale edits"),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ path, startLine, endLine, newContent, expectedHash, dryRun }) => {
      try {
        const r = await editLines(path, startLine, endLine, newContent, { expectedHash, dryRun });
        return text(`${r.message}\n\n${r.diff}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  addWriteTool(
    "create_dir",
    { title: "Create directory", description: "Create a directory (and parents). Supports dryRun.", inputSchema: { path: z.string(), dryRun: z.boolean().optional() } },
    async ({ path, dryRun }) => {
      try {
        return text(await createDir(path, { dryRun }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  addWriteTool(
    "move",
    { title: "Move/rename", description: "Move or rename a file/directory. No-clobber unless overwrite. Supports dryRun.", inputSchema: { source: z.string(), destination: z.string(), overwrite: z.boolean().optional(), dryRun: z.boolean().optional() } },
    async ({ source, destination, overwrite, dryRun }) => {
      try {
        return text(await move(source, destination, { overwrite, dryRun }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  addWriteTool(
    "copy",
    { title: "Copy", description: "Recursively copy a file/directory. Supports dryRun.", inputSchema: { source: z.string(), destination: z.string(), overwrite: z.boolean().optional(), dryRun: z.boolean().optional() } },
    async ({ source, destination, overwrite, dryRun }) => {
      try {
        return text(await copy(source, destination, { overwrite, dryRun }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  addWriteTool(
    "delete",
    {
      title: "Delete (to trash)",
      description: "Soft-delete a file/directory by moving it to the root's trash (recoverable via restore). Supports dryRun.",
      inputSchema: { path: z.string(), dryRun: z.boolean().optional() },
      annotations: { destructiveHint: true },
    },
    async ({ path, dryRun }) => {
      try {
        return text(await del(path, { dryRun }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  addWriteTool(
    "restore",
    { title: "Restore from trash", description: "Restore a soft-deleted item by its trash id (see list_trash).", inputSchema: { id: z.string(), overwrite: z.boolean().optional() } },
    async ({ id, overwrite }) => {
      try {
        return text(await restore(id, { overwrite }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  addWriteTool(
    "empty_trash",
    { title: "Empty trash", description: "Permanently delete all trashed items. Supports dryRun.", inputSchema: { dryRun: z.boolean().optional() }, annotations: { destructiveHint: true } },
    async ({ dryRun }) => {
      try {
        return text(await emptyTrash({ dryRun }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  addWriteTool(
    "zip",
    { title: "Create zip", description: "Create a .zip archive from one or more source paths. Supports dryRun.", inputSchema: { sources: z.array(z.string()), dest: z.string().describe("Output .zip path"), dryRun: z.boolean().optional() } },
    async ({ sources, dest, dryRun }) => {
      try {
        return text(await zip(sources, dest, { dryRun }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  addWriteTool(
    "unzip",
    { title: "Extract zip", description: "Extract a .zip into a directory (zip-slip protected). Supports dryRun + overwrite.", inputSchema: { path: z.string().describe("Path to .zip"), dest: z.string().describe("Destination directory"), overwrite: z.boolean().optional(), dryRun: z.boolean().optional() } },
    async ({ path, dest, overwrite, dryRun }) => {
      try {
        return text(await unzip(path, dest, { overwrite, dryRun }));
      } catch (err) {
        return fail(err);
      }
    },
  );
}

// --- Roots (best-effort augment; deprecated + unreliable, never required) --

async function augmentFromClientRoots(): Promise<void> {
  try {
    const caps = server.server.getClientCapabilities();
    if (!caps?.roots) return;
    const { roots } = await server.server.listRoots();
    const dirs = roots
      .map((r) => r.uri)
      .filter((u) => u.startsWith("file://"))
      .map((u) => fileURLToPath(u));
    if (dirs.length) await setRoots([...getRoots(), ...dirs]);
  } catch {
    // host doesn't implement roots (e.g. Claude Code) or it's disabled — ignore
  }
}

// --- Startup -------------------------------------------------------------

async function main() {
  await initRootsFromEnv();
  if (getRoots().length === 0) {
    console.error("Fatal: no sandbox roots. Set FS_ROOTS to one or more directories (comma-separated).");
    process.exit(1);
  }
  server.server.oninitialized = () => {
    void augmentFromClientRoots();
  };
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `mcp-files-server v${VERSION} running${isReadOnly() ? " (read-only)" : ""}. Roots: ${getRoots().join(", ")}`,
  );
}

main().catch((err) => {
  console.error("Fatal error starting mcp-files-server:", err);
  process.exit(1);
});
