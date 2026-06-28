/**
 * Quality-of-life note operations (v0.4): daily notes, templates, vault-wide
 * tag rename, and unlinked-mention discovery. Pure logic layered over store +
 * fsutil + parse; all mutations go through store so the index stays in sync.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getDailyDir, getNotesDir, getTemplateDir, todayStamp } from "./config.js";
import { readRaw, resolveSafe } from "./fsutil.js";
import { normalizeLinkTarget, parseNote } from "./parse.js";
import {
  appendNote,
  createNote,
  getAllMeta,
  getMeta,
  updateNoteRaw,
} from "./store.js";

/** Local-time HH:MM stamp for daily-note entries. */
function timeStamp(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// --- Daily notes ----------------------------------------------------------

export interface DailyResult {
  name: string;
  created: boolean;
  appended: boolean;
}

/**
 * Open (creating if needed) the daily note for `date` (YYYY-MM-DD, default
 * today) and optionally append a timestamped entry.
 */
export async function dailyNote(entry?: string, date?: string): Promise<DailyResult> {
  const stamp = date ?? todayStamp();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) {
    throw new Error(`Invalid date "${stamp}" — expected YYYY-MM-DD.`);
  }
  const name = `${getDailyDir()}/${stamp}`;
  const existed = getMeta(name) !== undefined;
  if (!existed) await createNote(name, `# ${stamp}\n`);
  let appended = false;
  if (entry && entry.trim()) {
    await appendNote(name, `- ${timeStamp()} ${entry.trim()}`);
    appended = true;
  }
  return { name: normalizeLinkTarget(name), created: !existed, appended };
}

// --- Templates ------------------------------------------------------------

/** Path to the template dir, rejecting an override that escapes the vault. */
function templateDirAbs(): string {
  const root = getNotesDir();
  const abs = path.resolve(root, getTemplateDir());
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("NOTES_TEMPLATE_DIR escapes the notes directory.");
  }
  return abs;
}

/** List available template names (without the .md extension). */
export async function listTemplates(): Promise<string[]> {
  try {
    const entries = await fs.readdir(templateDirAbs(), { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name.replace(/\.md$/, ""))
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Substitute {{date}} / {{time}} / {{title}} / {{var}} placeholders. */
function applyVars(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (whole, key: string) =>
    key in vars ? vars[key] : whole,
  );
}

/** Instantiate a template into a new note, substituting placeholders. */
export async function createFromTemplate(
  template: string,
  name: string,
  vars: Record<string, string> = {},
): Promise<string> {
  const raw = await readRaw(await resolveSafe(`${getTemplateDir()}/${template}`));
  const title = vars.title ?? name.split("/").pop() ?? name;
  const content = applyVars(raw, { date: todayStamp(), time: timeStamp(), title, ...vars });
  return createNote(name, content, false);
}

// --- Tag rename -----------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rewrite a tag token inside a YAML frontmatter block (list or inline forms). */
function rewriteFrontmatterTag(block: string, from: string, to: string): string {
  const re = new RegExp(`(^|[\\s\\[,'"-])(${escapeRegExp(from)})(?=[\\s\\],'"]|$)`, "gm");
  return block.replace(re, (_m, pre: string) => `${pre}${to}`);
}

/** Rewrite inline #hashtags (word-boundary, tag chars are [\w/-]). */
function rewriteInlineHashtag(text: string, from: string, to: string): string {
  const re = new RegExp(`(^|[^\\w#/-])#${escapeRegExp(from)}(?![\\w/-])`, "g");
  return text.replace(re, (_m, pre: string) => `${pre}#${to}`);
}

const FRONTMATTER_RE = /^(---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$))([\s\S]*)$/;

/** Rewrite a tag across the whole note (frontmatter + inline). */
function rewriteNoteTag(raw: string, from: string, to: string): string {
  const m = FRONTMATTER_RE.exec(raw);
  if (m) {
    const fm = rewriteFrontmatterTag(m[1], from, to);
    const body = rewriteInlineHashtag(m[2], from, to);
    return fm + body;
  }
  return rewriteInlineHashtag(raw, from, to);
}

export interface RenameTagResult {
  from: string;
  to: string;
  changed: string[];
}

/** Rename a tag across every note that carries it. */
export async function renameTag(from: string, to: string): Promise<RenameTagResult> {
  const f = from.replace(/^#/, "").trim();
  const t = to.replace(/^#/, "").trim();
  if (!f || !t) throw new Error("Both tag names are required.");
  const changed: string[] = [];
  for (const [name, meta] of getAllMeta()) {
    if (!meta.tags.some((tag) => tag.toLowerCase() === f.toLowerCase())) continue;
    const raw = await readRaw(await resolveSafe(name));
    const updated = rewriteNoteTag(raw, f, t);
    if (updated !== raw) {
      await updateNoteRaw(name, updated);
      changed.push(name);
    }
  }
  return { from: f, to: t, changed: changed.sort() };
}

// --- Unlinked mentions ----------------------------------------------------

export interface Mention {
  note: string;
  line: number;
  text: string;
}

/**
 * Find notes that mention `name`'s title as plain text but do NOT already link
 * to it via [[wiki-link]] — candidates for linking (Obsidian-style).
 */
export async function unlinkedMentions(name: string): Promise<Mention[]> {
  const target = normalizeLinkTarget(name);
  const self = getMeta(target);
  const title = (self?.title ?? target).trim();
  if (title.length < 2) return [];
  const re = new RegExp(`\\b${escapeRegExp(title)}\\b`, "i");
  const out: Mention[] = [];

  for (const [n, meta] of getAllMeta()) {
    if (n === target) continue;
    if (meta.outLinks.some((l) => normalizeLinkTarget(l) === target)) continue; // already linked
    const { body } = parseNote(await readRaw(await resolveSafe(n)));
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const stripped = lines[i].replace(/\[\[[^\]]+\]\]/g, ""); // ignore mentions inside links
      if (re.test(stripped)) {
        out.push({ note: n, line: i + 1, text: lines[i].trim() });
        break; // one hit per note is enough to flag it
      }
    }
  }
  return out;
}
