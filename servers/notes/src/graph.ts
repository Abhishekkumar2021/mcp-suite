/**
 * Knowledge-graph queries over the wiki-link + tag structure captured in the
 * store's per-note metadata. Everything here is read-only and returns compact
 * node references (name + title), never full note bodies, to stay token-cheap.
 */
import { normalizeLinkTarget } from "./parse.js";
import { getAllMeta, getMeta, noteExists, type NoteMeta } from "./store.js";

export interface NodeRef {
  name: string;
  title: string;
}

const ref = (name: string, meta?: NoteMeta): NodeRef => ({ name, title: meta?.title ?? name });

/** out: name -> existing targets it links to; in: name -> notes linking to it. */
function adjacency(): { out: Map<string, Set<string>>; inc: Map<string, Set<string>> } {
  const out = new Map<string, Set<string>>();
  const inc = new Map<string, Set<string>>();
  const meta = getAllMeta();
  for (const name of meta.keys()) {
    out.set(name, new Set());
    inc.set(name, new Set());
  }
  for (const [name, m] of meta) {
    for (const link of m.outLinks) {
      const target = normalizeLinkTarget(link);
      if (!meta.has(target) || target === name) continue; // skip broken + self
      out.get(name)!.add(target);
      inc.get(target)!.add(name);
    }
  }
  return { out, inc };
}

/** Notes that link to `name` via [[wiki-link]]. */
export function getBacklinks(name: string): NodeRef[] {
  const target = normalizeLinkTarget(name);
  const out: NodeRef[] = [];
  for (const [n, m] of getAllMeta()) {
    if (n === target) continue;
    if (m.outLinks.some((l) => normalizeLinkTarget(l) === target)) out.push(ref(n, m));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface Neighbor extends NodeRef {
  distance: number;
}

/** BFS over the undirected link graph up to `depth`, capped at `limit` nodes. */
export function getNeighbors(name: string, depth = 1, limit = 50): Neighbor[] {
  const start = normalizeLinkTarget(name);
  if (!noteExists(start)) return [];
  const { out, inc } = adjacency();
  const seen = new Set<string>([start]);
  const result: Neighbor[] = [];
  let frontier = [start];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = [];
    for (const node of frontier) {
      const around = new Set<string>([...(out.get(node) ?? []), ...(inc.get(node) ?? [])]);
      for (const nb of around) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        result.push({ ...ref(nb, getMeta(nb)), distance: d });
        next.push(nb);
        if (result.length >= limit) return result;
      }
    }
    frontier = next;
  }
  return result;
}

/** Shortest wiki-link chain between two notes (BFS, undirected). Null if none. */
export function findPath(a: string, b: string): NodeRef[] | null {
  const from = normalizeLinkTarget(a);
  const to = normalizeLinkTarget(b);
  if (!noteExists(from) || !noteExists(to)) return null;
  if (from === to) return [ref(from, getMeta(from))];
  const { out, inc } = adjacency();
  const prev = new Map<string, string>();
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    const node = queue.shift()!;
    const around = new Set<string>([...(out.get(node) ?? []), ...(inc.get(node) ?? [])]);
    for (const nb of around) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      prev.set(nb, node);
      if (nb === to) {
        const chain: string[] = [to];
        let cur = to;
        while (cur !== from) {
          cur = prev.get(cur)!;
          chain.unshift(cur);
        }
        return chain.map((n) => ref(n, getMeta(n)));
      }
      queue.push(nb);
    }
  }
  return null;
}

export interface RelatedNote extends NodeRef {
  score: number;
  sharedLinks: number;
  sharedTags: number;
}

/** Rank other notes by shared out-links + shared tags with `name`. */
export function relatedNotes(name: string, limit = 10): RelatedNote[] {
  const target = normalizeLinkTarget(name);
  const self = getMeta(target);
  if (!self) return [];
  const myLinks = new Set(self.outLinks.map(normalizeLinkTarget));
  const myTags = new Set(self.tags.map((t) => t.toLowerCase()));
  const scored: RelatedNote[] = [];
  for (const [n, m] of getAllMeta()) {
    if (n === target) continue;
    const sharedLinks = m.outLinks.filter((l) => myLinks.has(normalizeLinkTarget(l))).length;
    const sharedTags = m.tags.filter((t) => myTags.has(t.toLowerCase())).length;
    const score = sharedLinks + sharedTags;
    if (score > 0) scored.push({ ...ref(n, m), score, sharedLinks, sharedTags });
  }
  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

export interface GraphOverview {
  notes: number;
  links: number; // existing (resolvable) edges
  tags: number;
  brokenLinks: number;
  orphans: NodeRef[];
  hubs: Array<NodeRef & { degree: number }>;
}

/** Aggregate graph health: counts, top hubs, orphans. */
export function graphOverview(hubLimit = 10, orphanLimit = 25): GraphOverview {
  const { out, inc } = adjacency();
  const meta = getAllMeta();
  let links = 0;
  const tags = new Set<string>();
  const hubs: Array<NodeRef & { degree: number }> = [];
  const orphans: NodeRef[] = [];
  for (const [name, m] of meta) {
    for (const t of m.tags) tags.add(t.toLowerCase());
    const degree = (out.get(name)?.size ?? 0) + (inc.get(name)?.size ?? 0);
    links += out.get(name)?.size ?? 0;
    if (degree === 0) orphans.push(ref(name, m));
    hubs.push({ ...ref(name, m), degree });
  }
  return {
    notes: meta.size,
    links,
    tags: tags.size,
    brokenLinks: brokenLinks().length,
    orphans: orphans.slice(0, orphanLimit),
    hubs: hubs.filter((h) => h.degree > 0).sort((a, b) => b.degree - a.degree).slice(0, hubLimit),
  };
}

export interface BrokenLink {
  from: string;
  target: string;
}

/** Wiki-links that point at notes which don't exist. */
export function brokenLinks(): BrokenLink[] {
  const out: BrokenLink[] = [];
  for (const [name, m] of getAllMeta()) {
    for (const link of m.outLinks) {
      const target = normalizeLinkTarget(link);
      if (target && !noteExists(target)) out.push({ from: name, target });
    }
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.target.localeCompare(b.target));
}
