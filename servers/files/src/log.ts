/**
 * Structured logging + audit trail. Logs go to stderr only (stdout is the MCP
 * transport). Mutations are additionally appended to FS_AUDIT_LOG (if set) as
 * JSON lines, so a deployment has a durable record of what changed.
 */
import { promises as fs } from "node:fs";
import { getAuditLogPath } from "./config.js";

type Level = "debug" | "info" | "warn" | "error";

/** Emit a structured log line to stderr. */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const rec = { ts: new Date().toISOString(), level, msg, ...fields };
  console.error(JSON.stringify(rec));
}

export interface AuditEvent {
  tool: string;
  paths: string[];
  dryRun?: boolean;
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
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: "warn", msg: "audit append failed", error: (err as Error).message }));
  }
}
