/**
 * Semantic vector store: keeps an L2-normalized embedding per note, persisted to
 * a sidecar cache and incrementally synced (mtime/size) against the text index.
 * Mirrors store.ts's cache+sync pattern. The embedding model is only touched
 * when a semantic search actually runs (first call embeds the whole vault).
 */
import { promises as fs } from "node:fs";
import {
  EMBED_CACHE_VERSION,
  EMBED_DIM,
  EMBED_MODEL_ID,
  getEmbeddingsPath,
  cacheDisabled,
} from "./config.js";
import { atomicWrite, readRaw, resolveSafe } from "./fsutil.js";
import { parseNote } from "./parse.js";
import { embed } from "./embed.js";
import { getAllMeta, searchNotes, type SearchHit } from "./store.js";

interface VecEntry {
  mtimeMs: number;
  size: number;
  vec: Float32Array;
}

interface CacheShape {
  version: number;
  model: string;
  dim: number;
  perNote: Record<string, { mtimeMs: number; size: number; vector: string }>;
}

const vectors = new Map<string, VecEntry>();
let cacheLoaded = false;

function encodeVec(v: Float32Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
}
function decodeVec(b64: string): Float32Array {
  const buf = Buffer.from(b64, "base64");
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/** Load the persisted vectors once (ignored if model/dim/version changed). */
async function loadCache(): Promise<void> {
  if (cacheLoaded || cacheDisabled()) {
    cacheLoaded = true;
    return;
  }
  cacheLoaded = true;
  try {
    const cache = JSON.parse(await fs.readFile(getEmbeddingsPath(), "utf8")) as CacheShape;
    if (cache.version !== EMBED_CACHE_VERSION || cache.model !== EMBED_MODEL_ID || cache.dim !== EMBED_DIM) {
      return; // stale → will be rebuilt by sync
    }
    for (const [name, e] of Object.entries(cache.perNote ?? {})) {
      vectors.set(name, { mtimeMs: e.mtimeMs, size: e.size, vec: decodeVec(e.vector) });
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`Embeddings cache unreadable, rebuilding: ${(err as Error).message}`);
    }
  }
}

async function writeCache(): Promise<void> {
  if (cacheDisabled()) return;
  const perNote: CacheShape["perNote"] = {};
  for (const [name, e] of vectors) perNote[name] = { mtimeMs: e.mtimeMs, size: e.size, vector: encodeVec(e.vec) };
  const cache: CacheShape = { version: EMBED_CACHE_VERSION, model: EMBED_MODEL_ID, dim: EMBED_DIM, perNote };
  try {
    await atomicWrite(getEmbeddingsPath(), JSON.stringify(cache));
  } catch (err) {
    console.error(`Could not write embeddings cache: ${(err as Error).message}`);
  }
}

/** Embed new/changed notes, drop deleted ones, persist if anything changed. */
async function sync(): Promise<void> {
  await loadCache();
  const meta = getAllMeta();
  let changed = false;
  for (const [name, m] of meta) {
    const prev = vectors.get(name);
    if (prev && prev.mtimeMs === m.mtimeMs && prev.size === m.size) continue;
    try {
      const { title, body } = parseNote(await readRaw(await resolveSafe(name)));
      const vec = await embed(`${title ?? name}\n${body}`);
      vectors.set(name, { mtimeMs: m.mtimeMs, size: m.size, vec });
      changed = true;
    } catch (err) {
      console.error(`Could not embed "${name}": ${(err as Error).message}`);
    }
  }
  for (const name of [...vectors.keys()]) {
    if (!meta.has(name)) {
      vectors.delete(name);
      changed = true;
    }
  }
  if (changed) await writeCache();
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < EMBED_DIM; i++) s += a[i] * b[i];
  return s;
}

function snippet(body: string, width = 160): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > width ? `${flat.slice(0, width)}…` : flat;
}

async function snippetFor(name: string): Promise<string> {
  try {
    return snippet(parseNote(await readRaw(await resolveSafe(name))).body);
  } catch {
    return "";
  }
}

/**
 * Rank notes by semantic similarity to `query`. With `hybrid`, fuse the vector
 * ranking with MiniSearch's lexical ranking via Reciprocal Rank Fusion (k=60).
 * First call downloads/loads the model and embeds the whole vault.
 */
export async function semanticSearch(
  query: string,
  opts: { limit?: number; hybrid?: boolean } = {},
): Promise<{ hits: SearchHit[]; total: number; hasMore: boolean }> {
  const limit = opts.limit ?? 10;
  await sync();

  const qv = await embed(query);
  const ranked = [...vectors.entries()]
    .map(([name, e]) => ({ name, score: dot(qv, e.vec) }))
    .sort((a, b) => b.score - a.score);

  let order: Array<{ name: string; score: number }>;
  if (opts.hybrid) {
    const K = 60;
    const fused = new Map<string, number>();
    ranked.slice(0, 50).forEach((r, i) => fused.set(r.name, (fused.get(r.name) ?? 0) + 1 / (K + i + 1)));
    const lexical = await searchNotes(query, { limit: 50 });
    lexical.hits.forEach((h, i) => fused.set(h.name, (fused.get(h.name) ?? 0) + 1 / (K + i + 1)));
    order = [...fused.entries()].map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score);
  } else {
    order = ranked;
  }

  const total = order.length;
  const page = order.slice(0, limit);
  const meta = getAllMeta();
  const hits: SearchHit[] = [];
  for (const r of page) {
    hits.push({
      name: r.name,
      title: meta.get(r.name)?.title ?? r.name,
      score: r.score,
      snippet: await snippetFor(r.name),
    });
  }
  return { hits, total, hasMore: limit < total };
}
