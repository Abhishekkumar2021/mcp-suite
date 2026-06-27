#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  appendNote,
  createNote,
  deleteNote,
  ensureNotesDir,
  getBacklinks,
  getNotesDir,
  listNotes,
  readNote,
  searchNotes,
} from "./notes.js";

const server = new McpServer({
  name: "mcp-notes-server",
  version: "0.1.0",
});

// A small helper to wrap a string into the MCP text-content shape.
const text = (value: string) => ({
  content: [{ type: "text" as const, text: value }],
});

// --- Tools ---------------------------------------------------------------

server.registerTool(
  "list_notes",
  {
    title: "List notes",
    description:
      "List all markdown notes in the notes directory, newest first. " +
      "Returns each note's name, size, and last-modified time.",
    inputSchema: {},
  },
  async () => {
    const notes = await listNotes();
    if (notes.length === 0) return text("No notes found.");
    const lines = notes.map(
      (n) => `- ${n.name} (${n.size} bytes, modified ${n.modified})`,
    );
    return text(`Found ${notes.length} note(s):\n${lines.join("\n")}`);
  },
);

server.registerTool(
  "read_note",
  {
    title: "Read a note",
    description: "Read the full contents of a note by name (extension optional).",
    inputSchema: {
      name: z.string().describe("Note name, e.g. 'ideas' or 'projects/mcp'"),
    },
  },
  async ({ name }) => {
    try {
      return text(await readNote(name));
    } catch {
      return text(`Could not read note "${name}". Does it exist?`);
    }
  },
);

server.registerTool(
  "create_note",
  {
    title: "Create a note",
    description:
      "Create a new markdown note. Fails if it already exists unless overwrite is true.",
    inputSchema: {
      name: z.string().describe("Note name, e.g. 'ideas' or 'projects/mcp'"),
      content: z.string().describe("Markdown content of the note"),
      overwrite: z
        .boolean()
        .optional()
        .describe("Overwrite an existing note (default false)"),
    },
  },
  async ({ name, content, overwrite }) => {
    try {
      const file = await createNote(name, content, overwrite ?? false);
      return text(`Created note at ${file}`);
    } catch (err) {
      return text(`Failed to create note: ${(err as Error).message}`);
    }
  },
);

server.registerTool(
  "append_note",
  {
    title: "Append to a note",
    description:
      "Append content to an existing note (creates it if missing). " +
      "Useful for journals, logs, and running lists.",
    inputSchema: {
      name: z.string().describe("Note name"),
      content: z.string().describe("Markdown content to append"),
    },
  },
  async ({ name, content }) => {
    const file = await appendNote(name, content);
    return text(`Appended to ${file}`);
  },
);

server.registerTool(
  "delete_note",
  {
    title: "Delete a note",
    description: "Permanently delete a note by name.",
    inputSchema: {
      name: z.string().describe("Note name to delete"),
    },
    annotations: { destructiveHint: true },
  },
  async ({ name }) => {
    try {
      await deleteNote(name);
      return text(`Deleted note "${name}".`);
    } catch {
      return text(`Could not delete note "${name}". Does it exist?`);
    }
  },
);

server.registerTool(
  "search_notes",
  {
    title: "Search notes",
    description:
      "Case-insensitive full-text search across all notes. " +
      "Returns matching lines with their note name and line number.",
    inputSchema: {
      query: z.string().describe("Text to search for"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max number of matches (default 50)"),
    },
  },
  async ({ query, limit }) => {
    const hits = await searchNotes(query, limit ?? 50);
    if (hits.length === 0) return text(`No matches for "${query}".`);
    const lines = hits.map((h) => `${h.name}:${h.line}: ${h.text}`);
    return text(`${hits.length} match(es):\n${lines.join("\n")}`);
  },
);

server.registerTool(
  "get_backlinks",
  {
    title: "Get backlinks",
    description:
      "Find all notes that link to the given note using [[wiki-link]] syntax.",
    inputSchema: {
      name: z.string().describe("The note to find backlinks for"),
    },
  },
  async ({ name }) => {
    const hits = await getBacklinks(name);
    if (hits.length === 0) return text(`No notes link to "${name}".`);
    const lines = hits.map((h) => `${h.name}:${h.line}: ${h.text}`);
    return text(`${hits.length} backlink(s) to "${name}":\n${lines.join("\n")}`);
  },
);

// --- Resources -----------------------------------------------------------
// Expose every note as a readable resource via a notes:// URI scheme.

server.registerResource(
  "note",
  "notes://{name}",
  {
    title: "Note",
    description: "A markdown note, addressable by name.",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const name = decodeURIComponent(uri.pathname.replace(/^\/+/, "") || uri.href.replace("notes://", ""));
    const content = await readNote(name);
    return {
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: content }],
    };
  },
);

// --- Startup -------------------------------------------------------------

async function main() {
  await ensureNotesDir();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr — stdout is reserved for the MCP protocol.
  console.error(`mcp-notes-server running. Notes dir: ${getNotesDir()}`);
}

main().catch((err) => {
  console.error("Fatal error starting mcp-notes-server:", err);
  process.exit(1);
});
