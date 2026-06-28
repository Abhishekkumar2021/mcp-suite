import { homedir } from "node:os";
import path from "node:path";

/** Index cache format version — bump to force a full rebuild on upgrade. */
export const INDEX_VERSION = 1;

/** Cache file name kept inside the notes dir (excluded from notes). */
export const INDEX_FILENAME = ".notes-index.json";

/** Refuse to read/index any single note larger than this (DoS / context guard). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Resolve the notes directory from NOTES_DIR, defaulting to ~/notes.
 * A leading "~" is expanded to the home directory.
 */
export function getNotesDir(): string {
  const raw = process.env.NOTES_DIR ?? path.join(homedir(), "notes");
  const expanded = raw.startsWith("~")
    ? path.join(homedir(), raw.slice(1))
    : raw;
  return path.resolve(expanded);
}

/** Absolute path to the persisted index cache. */
export function getIndexPath(): string {
  return path.join(getNotesDir(), INDEX_FILENAME);
}

/** When true, all mutating tools are disabled (safe for sharing a vault read-only). */
export function isReadOnly(): boolean {
  return process.env.NOTES_READONLY === "1";
}

/** When true, skip the on-disk index cache and rebuild in memory each start. */
export function cacheDisabled(): boolean {
  return process.env.NOTES_NO_CACHE === "1";
}

// --- Semantic search (v0.3) ----------------------------------------------

/** Embedding model identity (recorded in the cache to invalidate on change). */
export const EMBED_MODEL_ID = "Xenova/all-MiniLM-L6-v2:quantized";
/** Embedding dimensionality of all-MiniLM-L6-v2. */
export const EMBED_DIM = 384;
/** Max WordPiece tokens fed to the model (longer notes are truncated). */
export const EMBED_MAX_TOKENS = 256;
/** Bump to force re-embedding of every note on upgrade. */
export const EMBED_CACHE_VERSION = 1;
/** Sidecar cache of per-note vectors, kept inside the notes dir. */
export const EMBEDDINGS_FILENAME = ".notes-embeddings.json";

const HF_BASE = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main";
/** Quantized ONNX model (~23 MB) — downloaded once at runtime. */
export const EMBED_MODEL_URL = `${HF_BASE}/onnx/model_quantized.onnx`;
/** BERT-uncased vocabulary (~232 KB) for the hand-rolled tokenizer. */
export const EMBED_VOCAB_URL = `${HF_BASE}/vocab.txt`;
/** Local filenames for the cached artifacts. */
export const EMBED_MODEL_FILE = "all-MiniLM-L6-v2.quantized.onnx";
export const EMBED_VOCAB_FILE = "all-MiniLM-L6-v2.vocab.txt";

/**
 * Directory where the embedding model + vocab are cached (downloaded once per
 * machine). Override with NOTES_MODEL_DIR; defaults to ~/.cache/mcp-notes/models.
 */
export function getModelDir(): string {
  const override = process.env.NOTES_MODEL_DIR;
  if (override) {
    const expanded = override.startsWith("~") ? path.join(homedir(), override.slice(1)) : override;
    return path.resolve(expanded);
  }
  return path.join(homedir(), ".cache", "mcp-notes", "models");
}

/** Absolute path to the persisted embeddings cache (sidecar to the text index). */
export function getEmbeddingsPath(): string {
  return path.join(getNotesDir(), EMBEDDINGS_FILENAME);
}

// --- Note-app quality-of-life (v0.4) -------------------------------------

/** Subdirectory (within the vault) for daily notes. Override with NOTES_DAILY_DIR. */
export function getDailyDir(): string {
  return process.env.NOTES_DAILY_DIR || "daily";
}

/** Subdirectory (within the vault) holding note templates. Override with NOTES_TEMPLATE_DIR. */
export function getTemplateDir(): string {
  return process.env.NOTES_TEMPLATE_DIR || "templates";
}

/** Local-time date stamp, YYYY-MM-DD (the daily-note naming scheme). */
export function todayStamp(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
