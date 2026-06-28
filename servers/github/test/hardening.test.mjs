// Unit tests for v0.2 hardening: secret redaction, config getters, audit log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { redact, audit } from "../dist/log.js";
import { requestTimeoutMs, getApiBaseUrl, getAuditLogPath, MAX_ITEMS } from "../dist/config.js";

test("redact strips GitHub token patterns", () => {
  const out = redact("token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 and github_pat_11ABCDEFG0aBcDeFgHiJkLmNoP done");
  assert.doesNotMatch(out, /ghp_ABCDEFG/);
  assert.doesNotMatch(out, /github_pat_11ABCDEFG/);
  assert.match(out, /gh\*_\*\*\*/);
  assert.match(out, /github_pat_\*\*\*/);
});

test("config: request timeout default + override", () => {
  delete process.env.GITHUB_TIMEOUT_MS;
  assert.equal(requestTimeoutMs(), 30_000);
  process.env.GITHUB_TIMEOUT_MS = "1234";
  assert.equal(requestTimeoutMs(), 1234);
  delete process.env.GITHUB_TIMEOUT_MS;
});

test("config: API base URL default + GHES override", () => {
  delete process.env.GITHUB_API_URL;
  assert.equal(getApiBaseUrl(), "https://api.github.com");
  process.env.GITHUB_API_URL = "https://ghe.example.com/api/v3/";
  assert.equal(getApiBaseUrl(), "https://ghe.example.com/api/v3"); // trailing slash trimmed
  delete process.env.GITHUB_API_URL;
});

test("config: MAX_ITEMS is a sane cap", () => {
  assert.ok(MAX_ITEMS >= 100 && MAX_ITEMS <= 1000);
});

test("audit appends a JSON line to GITHUB_AUDIT_LOG", async () => {
  const file = path.join(os.tmpdir(), `ghaudit-${Date.now()}.log`);
  process.env.GITHUB_AUDIT_LOG = file;
  assert.equal(getAuditLogPath(), file);
  await audit({ tool: "create_issue", target: "o/r#1", outcome: "ok" });
  const log = await fs.readFile(file, "utf8");
  assert.match(log, /"tool":"create_issue"/);
  assert.match(log, /"outcome":"ok"/);
  delete process.env.GITHUB_AUDIT_LOG;
  await fs.rm(file, { force: true });
});
