#!/usr/bin/env node
/**
 * @abhishekmcp/notes — MCP server for local markdown notes.
 * v0.2: ranked full-text search (MiniSearch), tags + todos, a wiki-link
 * knowledge graph, a persisted index with incremental sync, and FS hardening.
 * Tool registration only — all logic lives in store.ts / graph.ts.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { isReadOnly } from "./config.js";
import {
  appendNote,
  buildIndex,
  createNote,
  deleteNote,
  getOutline,
  listNotes,
  listTags,
  listTodos,
  moveNote,
  notesDir,
  readNote,
  searchNotes,
} from "./store.js";
import {
  brokenLinks,
  findPath,
  getBacklinks,
  getNeighbors,
  graphOverview,
  relatedNotes,
} from "./graph.js";

const server = new McpServer({ name: "mcp-notes-server", version: "0.2.0" });

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const fail = (err: unknown) => text(`Error: ${(err as Error).message}`);

// --- Read & discovery tools (always registered) --------------------------

server.registerTool(
  "list_notes",
  {
    title: "List notes",
    description:
      "List notes (newest first) with pagination and an optional tag filter. " +
      "Returns name, title, size, tags, and whether more results remain.",
    inputSchema: {
      offset: z.number().int().min(0).optional().describe("Start index (default 0)"),
      limit: z.number().int().positive().max(500).optional().describe("Max results (default 50)"),
      tag: z.string().optional().describe("Only notes carrying this tag"),
    },
  },
  async ({ offset, limit, tag }) => {
    const r = listNotes(offset ?? 0, limit ?? 50, tag);
    if (r.items.length === 0) return text(tag ? `No notes tagged "${tag}".` : "No notes found.");
    const lines = r.items.map((n) => `- ${n.name} — ${n.title}${n.tags.length ? ` [${n.tags.join(", ")}]` : ""}`);
    return text(`${r.total} note(s)${r.hasMore ? " (more available)" : ""}:\n${lines.join("\n")}`);
  },
);

server.registerTool(
  "read_note",
  {
    title: "Read a note",
    description:
      "Read a note by name. Optionally read just one heading's `section`, or a " +
      "character window via `offset`/`limit` (sets a truncated flag when cut).",
    inputSchema: {
      name: z.string().describe("Note name, e.g. 'ideas' or 'projects/mcp'"),
      section: z.string().optional().describe("Read only the content under this heading"),
      offset: z.number().int().min(0).optional().describe("Character offset to start from"),
      limit: z.number().int().positive().optional().describe("Max characters to return"),
    },
  },
  async ({ name, section, offset, limit }) => {
    try {
      const r = await readNote(name, { section, offset, limit });
      return text(r.truncated ? `${r.text}\n\n[truncated]` : r.text);
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "get_outline",
  {
    title: "Get note outline",
    description: "Return just the heading tree of a note — grasp a big note in a few tokens.",
    inputSchema: { name: z.string().describe("Note name") },
  },
  async ({ name }) => {
    try {
      return text(await getOutline(name));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "search_notes",
  {
    title: "Search notes",
    description:
      "Ranked full-text search. Supports `fuzzy`, `prefix`, and a `field` filter " +
      "(title/tag/body, or 'path' to match the note name). Returns ranked snippets.",
    inputSchema: {
      query: z.string().describe("Search query"),
      fuzzy: z.boolean().optional().describe("Enable fuzzy matching (typo-tolerant)"),
      prefix: z.boolean().optional().describe("Match term prefixes (default true)"),
      field: z.enum(["title", "tag", "body", "path"]).optional().describe("Restrict search to one field"),
      offset: z.number().int().min(0).optional().describe("Start index (default 0)"),
      limit: z.number().int().positive().max(100).optional().describe("Max results (default 10)"),
    },
  },
  async ({ query, fuzzy, prefix, field, offset, limit }) => {
    const r = await searchNotes(query, { fuzzy, prefix, field, offset, limit });
    if (r.hits.length === 0) return text(`No matches for "${query}".`);
    const lines = r.hits.map(
      (h) => `- ${h.name} (score ${h.score.toFixed(2)})${h.snippet ? `\n    ${h.snippet}` : ""}`,
    );
    return text(`${r.total} match(es)${r.hasMore ? " (more available)" : ""}:\n${lines.join("\n")}`);
  },
);

server.registerTool(
  "list_tags",
  {
    title: "List tags",
    description: "List every tag across the vault with note counts.",
    inputSchema: {},
  },
  async () => {
    const tags = listTags();
    if (tags.length === 0) return text("No tags found.");
    return text(tags.map((t) => `- ${t.tag} (${t.count})`).join("\n"));
  },
);

server.registerTool(
  "list_todos",
  {
    title: "List todos",
    description: "Aggregate `- [ ]` checkbox todos across all notes. Open items only unless includeDone.",
    inputSchema: {
      includeDone: z.boolean().optional().describe("Include completed `- [x]` items (default false)"),
    },
  },
  async ({ includeDone }) => {
    const todos = await listTodos(includeDone ?? false);
    if (todos.length === 0) return text("No todos found.");
    const lines = todos.map((t) => `- [${t.done ? "x" : " "}] ${t.text}  (${t.note}:${t.line})`);
    return text(`${todos.length} todo(s):\n${lines.join("\n")}`);
  },
);

server.registerTool(
  "get_backlinks",
  {
    title: "Get backlinks",
    description: "Find all notes that link to the given note via [[wiki-link]] syntax.",
    inputSchema: { name: z.string().describe("The note to find backlinks for") },
  },
  async ({ name }) => {
    const links = getBacklinks(name);
    if (links.length === 0) return text(`No notes link to "${name}".`);
    return text(`${links.length} backlink(s):\n${links.map((l) => `- ${l.name} — ${l.title}`).join("\n")}`);
  },
);

server.registerTool(
  "get_neighbors",
  {
    title: "Get neighbors",
    description: "Notes within N hops of a note over the (undirected) wiki-link graph, depth/limit capped.",
    inputSchema: {
      name: z.string().describe("Center note"),
      depth: z.number().int().positive().max(5).optional().describe("Hops to traverse (default 1)"),
      limit: z.number().int().positive().max(200).optional().describe("Max neighbors (default 50)"),
    },
  },
  async ({ name, depth, limit }) => {
    const nb = getNeighbors(name, depth ?? 1, limit ?? 50);
    if (nb.length === 0) return text(`"${name}" has no neighbors (or doesn't exist).`);
    return text(nb.map((n) => `- [${n.distance}] ${n.name} — ${n.title}`).join("\n"));
  },
);

server.registerTool(
  "find_path",
  {
    title: "Find path",
    description: "Shortest wiki-link chain between two notes (BFS). Reports if none exists.",
    inputSchema: {
      from: z.string().describe("Start note"),
      to: z.string().describe("End note"),
    },
  },
  async ({ from, to }) => {
    const path = findPath(from, to);
    if (!path) return text(`No path between "${from}" and "${to}".`);
    return text(path.map((n) => n.name).join(" → "));
  },
);

server.registerTool(
  "related_notes",
  {
    title: "Related notes",
    description: "Rank other notes by shared wiki-links and shared tags with the given note.",
    inputSchema: {
      name: z.string().describe("Note to find relations for"),
      limit: z.number().int().positive().max(50).optional().describe("Max results (default 10)"),
    },
  },
  async ({ name, limit }) => {
    const rel = relatedNotes(name, limit ?? 10);
    if (rel.length === 0) return text(`No related notes for "${name}".`);
    return text(
      rel
        .map((r) => `- ${r.name} — ${r.title} (score ${r.score}: ${r.sharedLinks} links, ${r.sharedTags} tags)`)
        .join("\n"),
    );
  },
);

server.registerTool(
  "graph_overview",
  {
    title: "Graph overview",
    description: "Aggregate graph health: note/link/tag counts, top hubs, orphans, broken-link count.",
    inputSchema: {},
  },
  async () => {
    const g = graphOverview();
    const hubs = g.hubs.map((h) => `${h.name} (${h.degree})`).join(", ") || "none";
    const orphans = g.orphans.map((o) => o.name).join(", ") || "none";
    return text(
      `Notes: ${g.notes}\nLinks: ${g.links}\nTags: ${g.tags}\nBroken links: ${g.brokenLinks}\n` +
        `Hubs: ${hubs}\nOrphans: ${orphans}`,
    );
  },
);

server.registerTool(
  "broken_links",
  {
    title: "Broken links",
    description: "List wiki-links that point at notes which don't exist.",
    inputSchema: {},
  },
  async () => {
    const broken = brokenLinks();
    if (broken.length === 0) return text("No broken links. 🎉");
    return text(`${broken.length} broken link(s):\n${broken.map((b) => `- ${b.from} → [[${b.target}]]`).join("\n")}`);
  },
);

// --- Mutating tools (omitted entirely when NOTES_READONLY=1) --------------

if (!isReadOnly()) {
  server.registerTool(
    "create_note",
    {
      title: "Create a note",
      description: "Create a new markdown note. Fails if it exists unless overwrite is true.",
      inputSchema: {
        name: z.string().describe("Note name, e.g. 'ideas' or 'projects/mcp'"),
        content: z.string().describe("Markdown content"),
        overwrite: z.boolean().optional().describe("Overwrite if it already exists (default false)"),
      },
    },
    async ({ name, content, overwrite }) => {
      try {
        const n = await createNote(name, content, overwrite ?? false);
        return text(`Created note "${n}".`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "append_note",
    {
      title: "Append to a note",
      description: "Append content to a note (creating it if missing). Good for journals and logs.",
      inputSchema: {
        name: z.string().describe("Note name"),
        content: z.string().describe("Markdown content to append"),
      },
    },
    async ({ name, content }) => {
      try {
        const n = await appendNote(name, content);
        return text(`Appended to "${n}".`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete a note",
      description: "Permanently delete a note by name.",
      inputSchema: { name: z.string().describe("Note name to delete") },
      annotations: { destructiveHint: true },
    },
    async ({ name }) => {
      try {
        await deleteNote(name);
        return text(`Deleted note "${name}".`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "move_note",
    {
      title: "Move/rename a note",
      description:
        "Rename or move a note and rewrite every [[wiki-link]] pointing at it across the vault.",
      inputSchema: {
        from: z.string().describe("Current note name"),
        to: z.string().describe("New note name/path"),
      },
    },
    async ({ from, to }) => {
      try {
        const r = await moveNote(from, to);
        const rw = r.rewritten.length ? ` Rewrote backlinks in: ${r.rewritten.join(", ")}.` : "";
        return text(`Moved "${r.from}" → "${r.to}".${rw}`);
      } catch (err) {
        return fail(err);
      }
    },
  );
}

// --- Resources -----------------------------------------------------------

server.registerResource(
  "note",
  "notes://{name}",
  { title: "Note", description: "A markdown note, addressable by name.", mimeType: "text/markdown" },
  async (uri) => {
    const name = decodeURIComponent(
      uri.pathname.replace(/^\/+/, "") || uri.href.replace("notes://", ""),
    );
    const { text: content } = await readNote(name);
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: content }] };
  },
);

// --- Startup -------------------------------------------------------------

async function main() {
  await buildIndex(); // load/sync the index before serving any request
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `mcp-notes-server v0.2.0 running${isReadOnly() ? " (read-only)" : ""}. Notes dir: ${notesDir()}`,
  );
}

main().catch((err) => {
  console.error("Fatal error starting mcp-notes-server:", err);
  process.exit(1);
});
