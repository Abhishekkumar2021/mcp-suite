/**
 * Lazy embedding engine: runs all-MiniLM-L6-v2 (ONNX) on onnxruntime-web (WASM,
 * no native deps). The model + vocab are downloaded once to a persistent cache
 * on first use; nothing here runs at server startup. `onnxruntime-web` is
 * dynamically imported so a server that never does semantic search never loads
 * the WASM runtime.
 */
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as OrtNS from "onnxruntime-web";
import {
  EMBED_DIM,
  EMBED_MAX_TOKENS,
  EMBED_MODEL_FILE,
  EMBED_MODEL_URL,
  EMBED_VOCAB_FILE,
  EMBED_VOCAB_URL,
  getModelDir,
} from "./config.js";
import { WordPieceTokenizer } from "./tokenizer.js";

let session: OrtNS.InferenceSession | null = null;
let tokenizer: WordPieceTokenizer | null = null;
let initPromise: Promise<void> | null = null;

/** Download a URL to `dest` atomically (temp + rename), retrying on 429/5xx. */
async function download(url: string, dest: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status} fetching ${url}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const tmp = `${dest}.${process.pid}.tmp`;
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, dest);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); // backoff
    }
  }
  throw new Error(`Failed to download ${url}: ${(lastErr as Error)?.message ?? lastErr}`);
}

/** Ensure a cached file exists, downloading it if missing. */
async function ensureFile(url: string, dest: string): Promise<void> {
  try {
    await fs.access(dest);
  } catch {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await download(url, dest);
  }
}

/** Download artifacts (once) and build the tokenizer + WASM inference session. */
async function init(): Promise<void> {
  const dir = getModelDir();
  const modelPath = path.join(dir, EMBED_MODEL_FILE);
  const vocabPath = path.join(dir, EMBED_VOCAB_FILE);
  await ensureFile(EMBED_VOCAB_URL, vocabPath);
  await ensureFile(EMBED_MODEL_URL, modelPath);

  tokenizer = new WordPieceTokenizer(await fs.readFile(vocabPath, "utf8"));

  const ort = await import("onnxruntime-web");
  ort.env.wasm.numThreads = 1; // single-thread: no SharedArrayBuffer / worker isolation needed
  // Best-effort: point the WASM loader at the .wasm shipped in node_modules.
  // (onnxruntime-web self-resolves from its own module URL when this isn't set.)
  try {
    const require = createRequire(import.meta.url);
    ort.env.wasm.wasmPaths = path.dirname(require.resolve("onnxruntime-web")) + path.sep;
  } catch {
    /* fall back to onnxruntime-web's own resolution */
  }

  const modelBytes = new Uint8Array(await fs.readFile(modelPath));
  session = await ort.InferenceSession.create(modelBytes, { executionProviders: ["wasm"] });
}

/** Idempotent, concurrency-safe lazy initialization. */
export async function ensureModel(): Promise<void> {
  if (session && tokenizer) return;
  if (!initPromise) {
    initPromise = init().catch((err) => {
      initPromise = null; // allow retry on a later call
      throw err;
    });
  }
  await initPromise;
}

/** True once the model has been downloaded + loaded. */
export function isReady(): boolean {
  return session !== null && tokenizer !== null;
}

/**
 * Embed a single text into an L2-normalized 384-dim vector (cosine == dot
 * product). Mean-pools the model's last_hidden_state over the attention mask.
 */
export async function embed(text: string): Promise<Float32Array> {
  await ensureModel();
  const ort = await import("onnxruntime-web");
  const tok = tokenizer!.encode(text, EMBED_MAX_TOKENS);
  const seq = tok.inputIds.length;
  const dims = [1, seq];

  const feeds: Record<string, OrtNS.Tensor> = {
    input_ids: new ort.Tensor("int64", BigInt64Array.from(tok.inputIds, BigInt), dims),
    attention_mask: new ort.Tensor("int64", BigInt64Array.from(tok.attentionMask, BigInt), dims),
  };
  // Some exports require token_type_ids (all-zero for a single segment).
  if (session!.inputNames.includes("token_type_ids")) {
    feeds.token_type_ids = new ort.Tensor("int64", new BigInt64Array(seq), dims);
  }

  const results = await session!.run(feeds);
  const outName = session!.outputNames.includes("last_hidden_state")
    ? "last_hidden_state"
    : session!.outputNames[0];
  const data = results[outName].data as Float32Array; // [1, seq, EMBED_DIM]

  // Mean-pool over tokens weighted by the attention mask, then L2-normalize.
  const out = new Float32Array(EMBED_DIM);
  let maskSum = 0;
  for (let t = 0; t < seq; t++) {
    const m = tok.attentionMask[t];
    if (!m) continue;
    maskSum += m;
    const base = t * EMBED_DIM;
    for (let d = 0; d < EMBED_DIM; d++) out[d] += data[base + d] * m;
  }
  const denom = maskSum || 1;
  let norm = 0;
  for (let d = 0; d < EMBED_DIM; d++) {
    out[d] /= denom;
    norm += out[d] * out[d];
  }
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < EMBED_DIM; d++) out[d] /= norm;
  return out;
}
