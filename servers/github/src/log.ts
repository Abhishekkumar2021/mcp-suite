/**
 * Structured logging + audit trail. Logs go to stderr only (stdout is the MCP
 * transport). Mutations are additionally appended to GITHUB_AUDIT_LOG (if set)
 * as JSON lines. Token values are never logged (see redact in index.ts).
 */
import { promises as fs } from "node:fs";
import { getAuditLogPath } from "./config.js";

/** Strip any GitHub token patterns from text (defense-in-depth before output). */
export function redact(s: string): string {
  return s
    .replace(/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, "gh*_***")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{16,}\b/g, "github_pat_***");
}

type Level = "debug" | "info" | "warn" | "error";

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
}

export interface AuditEvent {
  tool: string;
  target: string; // e.g. owner/repo#123
  outcome: "ok" | "error";
  detail?: string;
}

/** Record a mutation to stderr and (best-effort) the audit log file. */
export async function audit(event: AuditEvent): Promise<void> {
  const rec = { ts: new Date().toISOString(), kind: "audit", ...event };
  console.error(JSON.stringify(rec));
  const file = getAuditLogPath();
  if (!file) return;
  try {
    await fs.appendFile(file, JSON.stringify(rec) + "\n");
  } catch (err) {
    log("warn", "audit append failed", { error: (err as Error).message });
  }
}
