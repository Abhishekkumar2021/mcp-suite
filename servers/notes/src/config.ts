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
