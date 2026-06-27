import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Resolve the notes directory from the NOTES_DIR env var, defaulting to ~/notes.
 * A leading "~" is expanded to the user's home directory.
 */
export function getNotesDir(): string {
  const raw = process.env.NOTES_DIR ?? path.join(homedir(), "notes");
  const expanded = raw.startsWith("~")
    ? path.join(homedir(), raw.slice(1))
    : raw;
  return path.resolve(expanded);
}

/** Ensure the notes directory exists. */
export async function ensureNotesDir(): Promise<string> {
  const dir = getNotesDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Turn a user-supplied note name into a safe absolute path inside the notes
 * directory. Throws if the resolved path would escape the notes directory.
 * A ".md" extension is added when missing.
 */
export function resolveNotePath(name: string): string {
  const dir = getNotesDir();
  const withExt = name.endsWith(".md") ? name : `${name}.md`;
  const resolved = path.resolve(dir, withExt);

  const rel = path.relative(dir, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Refusing to access "${name}": path escapes the notes directory.`,
    );
  }
  return resolved;
}

export interface NoteInfo {
  name: string; // relative path without extension, e.g. "projects/idea"
  size: number;
  modified: string; // ISO timestamp
}

/** Recursively list all markdown notes in the notes directory. */
export async function listNotes(): Promise<NoteInfo[]> {
  const dir = await ensureNotesDir();
  const results: NoteInfo[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const stat = await fs.stat(full);
        const rel = path.relative(dir, full).replace(/\.md$/, "");
        results.push({
          name: rel,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }
    }
  }

  await walk(dir);
  results.sort((a, b) => b.modified.localeCompare(a.modified));
  return results;
}

export async function readNote(name: string): Promise<string> {
  const file = resolveNotePath(name);
  return fs.readFile(file, "utf8");
}

export async function createNote(
  name: string,
  content: string,
  overwrite = false,
): Promise<string> {
  const file = resolveNotePath(name);
  await fs.mkdir(path.dirname(file), { recursive: true });

  if (!overwrite) {
    try {
      await fs.access(file);
      throw new Error(
        `Note "${name}" already exists. Use overwrite or append instead.`,
      );
    } catch (err: unknown) {
      // ENOENT means it does not exist yet — that's what we want.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  await fs.writeFile(file, content, "utf8");
  return file;
}

export async function appendNote(
  name: string,
  content: string,
): Promise<string> {
  const file = resolveNotePath(name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Separate appended content with a blank line for readability.
  const prefix = content.startsWith("\n") ? "" : "\n\n";
  await fs.appendFile(file, prefix + content, "utf8");
  return file;
}

export async function deleteNote(name: string): Promise<void> {
  const file = resolveNotePath(name);
  await fs.unlink(file);
}

export interface SearchHit {
  name: string;
  line: number;
  text: string;
}

/** Case-insensitive substring search across all notes. */
export async function searchNotes(
  query: string,
  limit = 50,
): Promise<SearchHit[]> {
  const notes = await listNotes();
  const needle = query.toLowerCase();
  const hits: SearchHit[] = [];

  for (const note of notes) {
    const content = await readNote(note.name);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        hits.push({ name: note.name, line: i + 1, text: lines[i].trim() });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}

/**
 * Find notes that link to the given note via [[wiki-link]] syntax.
 * Matches the bare note name (with or without the .md extension).
 */
export async function getBacklinks(name: string): Promise<SearchHit[]> {
  const target = name.replace(/\.md$/, "");
  const notes = await listNotes();
  const hits: SearchHit[] = [];

  for (const note of notes) {
    if (note.name === target) continue;
    const content = await readNote(note.name);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const wikiLinks = lines[i].match(/\[\[([^\]]+)\]\]/g) ?? [];
      for (const link of wikiLinks) {
        const inner = link.slice(2, -2).split("|")[0].trim().replace(/\.md$/, "");
        if (inner === target) {
          hits.push({ name: note.name, line: i + 1, text: lines[i].trim() });
        }
      }
    }
  }
  return hits;
}
