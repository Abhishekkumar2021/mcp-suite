/**
 * Pure, dependency-free markdown parsing: a tiny YAML-frontmatter reader plus
 * extractors for headings, sections, wiki-links, tags and todos. We deliberately
 * avoid gray-matter / js-yaml (npm-audit noise + native-free goal); the subset of
 * YAML notes actually use in frontmatter is small enough to hand-roll safely.
 */

export interface Frontmatter {
  title?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface Heading {
  level: number; // 1–6
  text: string;
  line: number; // 1-based, relative to the body (frontmatter stripped)
}

export interface Todo {
  text: string;
  done: boolean;
  line: number; // 1-based, relative to the body
}

export interface ParsedNote {
  frontmatter: Frontmatter;
  body: string; // content with the frontmatter block removed
  title?: string; // frontmatter title, else first H1
  tags: string[]; // frontmatter tags + inline #hashtags, deduped
  links: string[]; // wiki-link targets, normalized + deduped
  headings: Heading[];
}

const WIKI_LINK = /\[\[([^\]]+)\]\]/g;
/** Inline #hashtag: a '#' not followed by whitespace (so markdown headings "# x" don't match). */
const HASHTAG = /(?:^|\s)#([A-Za-z0-9][\w/-]*)/g;

/** Strip a trailing ".md" and normalize separators so links/names compare equal. */
export function normalizeLinkTarget(raw: string): string {
  return raw.trim().replace(/\.md$/i, "").replace(/\\/g, "/").replace(/^\.?\/+/, "");
}

/** Strip surrounding single/double quotes from a scalar value. */
function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Parse `[a, b, "c"]` or `a, b, c` into a string list. */
function parseInlineList(v: string): string[] {
  let s = v.trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  return s
    .split(",")
    .map((x) => unquote(x))
    .filter((x) => x.length > 0);
}

/**
 * Split raw note text into a frontmatter object and the remaining body.
 * Recognizes a leading `---` ... `---` fence. Unparseable frontmatter is
 * treated as body (never throws).
 */
export function splitFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  // Must start with --- on the very first line.
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw);
  if (!m || raw.slice(0, 3) !== "---") {
    return { frontmatter: {}, body: raw };
  }
  const block = m[1];
  const body = raw.slice(m[0].length);
  const fm: Frontmatter = {};

  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const rest = kv[2];

    if (rest.trim() === "") {
      // Possible block list: subsequent "- item" lines.
      const items: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const item = /^[ \t]+-[ \t]+(.*)$/.exec(lines[j]);
        if (!item) break;
        items.push(unquote(item[1]));
      }
      if (items.length > 0) {
        fm[key] = key === "tags" ? items : items;
        i = j - 1;
      } else {
        fm[key] = "";
      }
      continue;
    }

    if (key === "tags") {
      fm.tags = parseInlineList(rest);
    } else if (rest.trim().startsWith("[")) {
      fm[key] = parseInlineList(rest);
    } else {
      fm[key] = unquote(rest);
    }
  }
  return { frontmatter: fm, body };
}

/** Extract ATX headings (`#`..`######`) from body text, ignoring fenced code blocks. */
export function extractHeadings(body: string): Heading[] {
  const out: Heading[] = [];
  const lines = body.split(/\r?\n/);
  let inFence = false;
  let fence = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^[ \t]*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fence = fenceMatch[1][0];
      } else if (line.trimStart().startsWith(fence)) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    const h = /^(#{1,6})[ \t]+(.+?)[ \t]*#*$/.exec(line);
    if (h) out.push({ level: h[1].length, text: h[2].trim(), line: i + 1 });
  }
  return out;
}

/**
 * Return the text under a heading (case-insensitive match on heading text),
 * up to the next heading of the same or higher level. Returns null if not found.
 */
export function extractSection(body: string, heading: string): string | null {
  const lines = body.split(/\r?\n/);
  const want = heading.trim().toLowerCase();
  const headings = extractHeadings(body);
  const start = headings.find((h) => h.text.toLowerCase() === want);
  if (!start) return null;
  const startIdx = start.line - 1;
  let endIdx = lines.length;
  for (const h of headings) {
    if (h.line - 1 > startIdx && h.level <= start.level) {
      endIdx = h.line - 1;
      break;
    }
  }
  // Include the heading line itself for context.
  return lines.slice(startIdx, endIdx).join("\n").trimEnd();
}

/** Extract wiki-link targets (`[[name]]` / `[[name|alias]]`), normalized + deduped. */
export function extractWikiLinks(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  WIKI_LINK.lastIndex = 0;
  while ((m = WIKI_LINK.exec(body)) !== null) {
    const target = normalizeLinkTarget(m[1].split("|")[0]);
    if (target && !seen.has(target)) {
      seen.add(target);
      out.push(target);
    }
  }
  return out;
}

/** Collect tags from frontmatter plus inline #hashtags in the body, deduped. */
export function extractTags(frontmatter: Frontmatter, body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (t: string) => {
    const tag = t.trim().replace(/^#/, "");
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  };
  if (Array.isArray(frontmatter.tags)) for (const t of frontmatter.tags) add(String(t));
  // Strip fenced code so code samples don't pollute tags.
  const withoutFences = body.replace(/(```+|~~~+)[\s\S]*?\1/g, "");
  let m: RegExpExecArray | null;
  HASHTAG.lastIndex = 0;
  while ((m = HASHTAG.exec(withoutFences)) !== null) add(m[1]);
  return out;
}

/** Extract checkbox todos (`- [ ]` / `- [x]`) from body text. */
export function extractTodos(body: string): Todo[] {
  const out: Todo[] = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^[ \t]*[-*+][ \t]+\[([ xX])\][ \t]+(.*)$/.exec(lines[i]);
    if (m) out.push({ done: m[1].toLowerCase() === "x", text: m[2].trim(), line: i + 1 });
  }
  return out;
}

/** Full parse of a raw note into structured pieces used by the index and graph. */
export function parseNote(raw: string): ParsedNote {
  const { frontmatter, body } = splitFrontmatter(raw);
  const headings = extractHeadings(body);
  const tags = extractTags(frontmatter, body);
  const links = extractWikiLinks(body);
  let title: string | undefined;
  if (typeof frontmatter.title === "string" && frontmatter.title.trim()) {
    title = frontmatter.title.trim();
  } else {
    const h1 = headings.find((h) => h.level === 1);
    if (h1) title = h1.text;
  }
  return { frontmatter, body, title, tags, links, headings };
}
