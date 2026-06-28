/**
 * The notes store: an in-memory MiniSearch full-text index + a wiki-link/tag
 * graph (derived from per-note metadata), persisted to a JSON cache for fast
 * warm starts with incremental mtime/size sync. Files on disk are the source of
 * truth; this module keeps the index, the graph metadata, and the cache in sync
 * across every mutation. All mutating ops are refused when NOTES_READONLY=1.
 */
import { promises as fs } from "node:fs";
import MiniSearch, { type Options } from "minisearch";
import {
  INDEX_VERSION,
  cacheDisabled,
  getIndexPath,
  getNotesDir,
  isReadOnly,
} from "./config.js";
import {
  atomicWrite,
  listNoteFiles,
  readRaw,
  resolveSafe,
  validateName,
} from "./fsutil.js";
import {
  extractSection,
  extractTodos,
  normalizeLinkTarget,
  parseNote,
} from "./parse.js";

/** Per-note metadata kept in memory and persisted to the cache. */
export interface NoteMeta {
  mtimeMs: number;
  size: number;
  title: string;
  tags: string[];
  outLinks: string[];
}

interface MiniDoc {
  name: string;
  title: string;
  body: string;
  tags: string;
}

interface CacheShape {
  version: number;
  perNote: Record<string, NoteMeta>;
  minisearch: unknown;
}

/** One fixed options object — reused for `new MiniSearch` and `loadJSON`. */
const MINI_OPTS: Options<MiniDoc> = {
  idField: "name",
  fields: ["title", "body", "tags"],
  storeFields: ["name", "title", "tags"],
};

let mini = new MiniSearch<MiniDoc>(MINI_OPTS);
const perNote = new Map<string, NoteMeta>();

// --- Index construction ---------------------------------------------------

/** Read + parse a note file into a search doc and its metadata. */
async function buildEntry(
  name: string,
  fullPath: string,
  mtimeMs: number,
  size: number,
): Promise<{ doc: MiniDoc; meta: NoteMeta }> {
  const raw = await readRaw(fullPath);
  const parsed = parseNote(raw);
  const title = parsed.title ?? name;
  const meta: NoteMeta = { mtimeMs, size, title, tags: parsed.tags, outLinks: parsed.links };
  const doc: MiniDoc = { name, title, body: parsed.body, tags: parsed.tags.join(" ") };
  return { doc, meta };
}

/** Add or replace a single note in the in-memory index + metadata map. */
async function indexNote(name: string, fullPath: string, mtimeMs: number, size: number): Promise<void> {
  const { doc, meta } = await buildEntry(name, fullPath, mtimeMs, size);
  if (perNote.has(name)) mini.discard(name);
  mini.add(doc);
  perNote.set(name, meta);
}

/** Remove a note from the in-memory index + metadata map. */
function unindexNote(name: string): void {
  if (perNote.has(name)) {
    mini.discard(name);
    perNote.delete(name);
  }
}

/** Build the index from scratch by walking the notes dir. */
async function fullRebuild(): Promise<void> {
  mini = new MiniSearch<MiniDoc>(MINI_OPTS);
  perNote.clear();
  const files = await listNoteFiles();
  for (const f of files) {
    try {
      await indexNote(f.name, f.fullPath, f.mtimeMs, f.size);
    } catch (err) {
      console.error(`Skipping unindexable note "${f.name}": ${(err as Error).message}`);
    }
  }
}

/** Persist the index + metadata to the on-disk cache (best-effort). */
async function writeCache(): Promise<void> {
  if (cacheDisabled()) return;
  const cache: CacheShape = {
    version: INDEX_VERSION,
    perNote: Object.fromEntries(perNote),
    minisearch: JSON.parse(JSON.stringify(mini)),
  };
  try {
    await atomicWrite(getIndexPath(), JSON.stringify(cache));
  } catch (err) {
    console.error(`Could not write index cache: ${(err as Error).message}`);
  }
}

/**
 * Load the index. Tries the cache and incrementally syncs against disk
 * (re-parsing only new/changed files, dropping deleted ones). Falls back to a
 * full rebuild if the cache is missing, unreadable, or the version changed.
 * Call once on startup before serving requests.
 */
export async function buildIndex(): Promise<void> {
  if (cacheDisabled()) {
    await fullRebuild();
    return;
  }
  let loaded = false;
  try {
    const raw = await fs.readFile(getIndexPath(), "utf8");
    const cache = JSON.parse(raw) as CacheShape;
    if (cache.version === INDEX_VERSION && cache.minisearch) {
      mini = MiniSearch.loadJSON<MiniDoc>(JSON.stringify(cache.minisearch), MINI_OPTS);
      perNote.clear();
      for (const [name, meta] of Object.entries(cache.perNote ?? {})) perNote.set(name, meta);
      loaded = true;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`Index cache unreadable, rebuilding: ${(err as Error).message}`);
    }
  }

  if (!loaded) {
    await fullRebuild();
    await writeCache();
    return;
  }

  // Incremental sync against the current files on disk.
  let changed = false;
  const files = await listNoteFiles();
  const onDisk = new Set<string>();
  for (const f of files) {
    onDisk.add(f.name);
    const prev = perNote.get(f.name);
    if (!prev || prev.mtimeMs !== f.mtimeMs || prev.size !== f.size) {
      try {
        await indexNote(f.name, f.fullPath, f.mtimeMs, f.size);
        changed = true;
      } catch (err) {
        console.error(`Skipping unindexable note "${f.name}": ${(err as Error).message}`);
      }
    }
  }
  for (const name of [...perNote.keys()]) {
    if (!onDisk.has(name)) {
      unindexNote(name);
      changed = true;
    }
  }
  if (changed) await writeCache();
}

// --- Graph accessors (used by graph.ts) -----------------------------------

export function getAllMeta(): Map<string, NoteMeta> {
  return perNote;
}
export function getMeta(name: string): NoteMeta | undefined {
  return perNote.get(normalizeLinkTarget(name));
}
export function noteExists(name: string): boolean {
  return perNote.has(normalizeLinkTarget(name));
}

// --- Read ops -------------------------------------------------------------

export interface NoteSummary {
  name: string;
  title: string;
  size: number;
  mtimeMs: number;
  tags: string[];
}

export interface ListResult {
  items: NoteSummary[];
  total: number;
  hasMore: boolean;
}

/** List notes (newest first), optionally filtered by tag, with pagination. */
export function listNotes(offset = 0, limit = 50, tag?: string): ListResult {
  let entries = [...perNote.entries()];
  if (tag) {
    const want = tag.toLowerCase().replace(/^#/, "");
    entries = entries.filter(([, m]) => m.tags.some((t) => t.toLowerCase() === want));
  }
  entries.sort((a, b) => b[1].mtimeMs - a[1].mtimeMs);
  const total = entries.length;
  const page = entries.slice(offset, offset + limit);
  return {
    items: page.map(([name, m]) => ({
      name,
      title: m.title,
      size: m.size,
      mtimeMs: m.mtimeMs,
      tags: m.tags,
    })),
    total,
    hasMore: offset + limit < total,
  };
}

export interface ReadResult {
  text: string;
  truncated: boolean;
}

/**
 * Read a note's content. With `section`, returns just that heading's block.
 * With `offset`/`limit` (character window), returns a slice + a `truncated` flag.
 */
export async function readNote(
  name: string,
  opts: { section?: string; offset?: number; limit?: number } = {},
): Promise<ReadResult> {
  const abs = await resolveSafe(name);
  const raw = await readRaw(abs);
  let text = raw;
  if (opts.section) {
    const { body } = parseNote(raw);
    const section = extractSection(body, opts.section);
    if (section === null) return { text: `Section "${opts.section}" not found in "${name}".`, truncated: false };
    text = section;
  }
  if (opts.offset !== undefined || opts.limit !== undefined) {
    const start = Math.max(0, opts.offset ?? 0);
    const end = opts.limit !== undefined ? start + opts.limit : text.length;
    const sliced = text.slice(start, end);
    return { text: sliced, truncated: end < text.length };
  }
  return { text, truncated: false };
}

/** Heading-tree outline of a note (cheap way to grasp a big note). */
export async function getOutline(name: string): Promise<string> {
  const abs = await resolveSafe(name);
  const raw = await readRaw(abs);
  const { headings } = parseNote(raw);
  if (headings.length === 0) return `"${name}" has no headings.`;
  return headings.map((h) => `${"  ".repeat(h.level - 1)}- ${h.text}`).join("\n");
}

// --- Mutations ------------------------------------------------------------

function assertWritable(): void {
  if (isReadOnly()) throw new Error("Server is read-only (NOTES_READONLY=1); mutations are disabled.");
}

/** Re-stat a file and (re)index it, then persist the cache. */
async function syncFromDisk(name: string): Promise<void> {
  const abs = await resolveSafe(name);
  const stat = await fs.stat(abs);
  await indexNote(normalizeLinkTarget(name), abs, stat.mtimeMs, stat.size);
}

/**
 * Overwrite an existing note's raw content and keep the index/graph/cache in
 * sync. Used by bulk rewrites (e.g. rename_tag) that edit files in place.
 */
export async function updateNoteRaw(name: string, content: string): Promise<void> {
  assertWritable();
  const abs = await resolveSafe(name);
  await atomicWrite(abs, content);
  await syncFromDisk(name);
  await writeCache();
}

export async function createNote(name: string, content: string, overwrite = false): Promise<string> {
  assertWritable();
  const abs = await resolveSafe(name);
  if (!overwrite) {
    try {
      await fs.access(abs);
      throw new Error(`Note "${name}" already exists. Use overwrite, or append_note.`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  await atomicWrite(abs, content);
  await syncFromDisk(name);
  await writeCache();
  return normalizeLinkTarget(name);
}

export async function appendNote(name: string, content: string): Promise<string> {
  assertWritable();
  const abs = await resolveSafe(name);
  let existing = "";
  try {
    existing = await readRaw(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const sep = existing && !existing.endsWith("\n") ? "\n\n" : existing ? "\n" : "";
  await atomicWrite(abs, existing + sep + content);
  await syncFromDisk(name);
  await writeCache();
  return normalizeLinkTarget(name);
}

export async function deleteNote(name: string): Promise<void> {
  assertWritable();
  const abs = await resolveSafe(name);
  await fs.unlink(abs);
  unindexNote(normalizeLinkTarget(name));
  await writeCache();
}

/** Replace wiki-links in `text` that point at `from` with `to` (alias preserved). */
function rewriteLinks(text: string, from: string, to: string): string {
  const fromNorm = normalizeLinkTarget(from);
  return text.replace(/\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
    const [target, ...aliasParts] = inner.split("|");
    if (normalizeLinkTarget(target) !== fromNorm) return whole;
    const alias = aliasParts.length ? `|${aliasParts.join("|")}` : "";
    return `[[${to}${alias}]]`;
  });
}

export interface MoveResult {
  from: string;
  to: string;
  rewritten: string[]; // notes whose backlinks were updated
}

/**
 * Move/rename a note and rewrite every `[[from]]` wiki-link across the vault to
 * `[[to]]`. Keeps the index, graph and cache consistent.
 */
export async function moveNote(from: string, to: string): Promise<MoveResult> {
  assertWritable();
  const fromNorm = normalizeLinkTarget(from);
  const toNorm = normalizeLinkTarget(to);
  const fromAbs = await resolveSafe(from);
  const toAbs = await resolveSafe(to);

  // Move the file (refuse to clobber an existing target).
  try {
    await fs.access(toAbs);
    throw new Error(`Target note "${to}" already exists.`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const content = await readRaw(fromAbs);
  await atomicWrite(toAbs, content);
  await fs.unlink(fromAbs);
  unindexNote(fromNorm);
  await syncFromDisk(toNorm);

  // Rewrite backlinks in every note that linked to `from`.
  const rewritten: string[] = [];
  for (const [name, meta] of [...perNote.entries()]) {
    if (name === toNorm) continue;
    if (!meta.outLinks.some((l) => normalizeLinkTarget(l) === fromNorm)) continue;
    const abs = await resolveSafe(name);
    const text = await readRaw(abs);
    const updated = rewriteLinks(text, fromNorm, toNorm);
    if (updated !== text) {
      await atomicWrite(abs, updated);
      await syncFromDisk(name);
      rewritten.push(name);
    }
  }
  await writeCache();
  return { from: fromNorm, to: toNorm, rewritten };
}

// --- Search ---------------------------------------------------------------

export interface SearchHit {
  name: string;
  title: string;
  score: number;
  snippet: string;
}

export interface SearchResultPage {
  hits: SearchHit[];
  total: number;
  hasMore: boolean;
}

const FIELD_MAP: Record<string, string> = { title: "title", tag: "tags", tags: "tags", body: "body" };

/** Build a ±context snippet around the first query-term hit in the body. */
function makeSnippet(body: string, terms: string[], width = 160): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const lower = flat.toLowerCase();
  let pos = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (pos === -1 || i < pos)) pos = i;
  }
  if (pos === -1) return flat.slice(0, width) + (flat.length > width ? "…" : "");
  const half = Math.floor(width / 2);
  const start = Math.max(0, pos - half);
  const end = Math.min(flat.length, pos + half);
  return (start > 0 ? "…" : "") + flat.slice(start, end).trim() + (end < flat.length ? "…" : "");
}

/**
 * Ranked full-text search. Supports `fuzzy`, `prefix`, a `field` filter
 * (title/tag/body, or `path` to match the note name), and pagination. Returns
 * ranked snippets with surrounding context.
 */
export async function searchNotes(
  query: string,
  opts: { fuzzy?: boolean; prefix?: boolean; field?: string; offset?: number; limit?: number } = {},
): Promise<SearchResultPage> {
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 10;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  // `path:` is not an indexed field — filter note names directly.
  if (opts.field === "path" || opts.field === "name") {
    const matches = [...perNote.entries()]
      .filter(([name]) => terms.every((t) => name.toLowerCase().includes(t)))
      .map(([name, m]) => ({ name, title: m.title, score: 1, snippet: "" }));
    return { hits: matches.slice(offset, offset + limit), total: matches.length, hasMore: offset + limit < matches.length };
  }

  const searchOpts: Record<string, unknown> = {
    prefix: opts.prefix ?? true,
    fuzzy: opts.fuzzy ? 0.2 : false,
    boost: { title: 2, tags: 1.5 },
  };
  if (opts.field && FIELD_MAP[opts.field]) searchOpts.fields = [FIELD_MAP[opts.field]];

  const results = mini.search(query, searchOpts);
  const total = results.length;
  const page = results.slice(offset, offset + limit);

  const hits: SearchHit[] = [];
  for (const r of page) {
    const name = r.id as string;
    let snippet = "";
    try {
      const abs = await resolveSafe(name);
      const { body } = parseNote(await readRaw(abs));
      snippet = makeSnippet(body, terms);
    } catch {
      // Note vanished since indexing — skip snippet.
    }
    hits.push({ name, title: (r.title as string) ?? name, score: r.score, snippet });
  }
  return { hits, total, hasMore: offset + limit < total };
}

// --- Tags & todos ---------------------------------------------------------

export interface TagCount {
  tag: string;
  count: number;
}

/** All tags across the vault with note counts (case-insensitive grouping). */
export function listTags(): TagCount[] {
  const counts = new Map<string, { display: string; count: number }>();
  for (const m of perNote.values()) {
    for (const t of m.tags) {
      const key = t.toLowerCase();
      const cur = counts.get(key);
      if (cur) cur.count++;
      else counts.set(key, { display: t, count: 1 });
    }
  }
  return [...counts.values()]
    .map((c) => ({ tag: c.display, count: c.count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export interface TodoItem {
  note: string;
  text: string;
  done: boolean;
  line: number;
}

/** Aggregate `- [ ]` / `- [x]` checkboxes across all notes. */
export async function listTodos(includeDone = false): Promise<TodoItem[]> {
  const out: TodoItem[] = [];
  for (const name of perNote.keys()) {
    try {
      const abs = await resolveSafe(name);
      const { body } = parseNote(await readRaw(abs));
      for (const t of extractTodos(body)) {
        if (!includeDone && t.done) continue;
        out.push({ note: name, text: t.text, done: t.done, line: t.line });
      }
    } catch {
      // skip unreadable note
    }
  }
  return out;
}

/** Notes-dir banner for startup logging. */
export function notesDir(): string {
  return getNotesDir();
}

/** Exposed for tests: validate a name without touching disk. */
export { validateName };
