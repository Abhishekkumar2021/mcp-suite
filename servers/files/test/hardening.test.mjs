// Integration tests for v0.2 hardening: denylist, encoding, audit, readonly,
// startup guard, plus a happy-path regression. Each test uses its own server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SERVER, startSeeded, callText } from "./_helpers.mjs";

test("denylist: reading a secret file is refused", async () => {
  const { root, c } = await startSeeded();
  try {
    assert.match(await callText(c, "read_file", { path: ".env" }), /denied/i);
  } finally {
    c.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("denylist: secrets are hidden from list_dir", async () => {
  const { root, c } = await startSeeded();
  try {
    assert.doesNotMatch(await callText(c, "list_dir", { path: "." }), /\.env/);
  } finally {
    c.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("denylist: FS_ALLOW_SECRETS=1 overrides the block", async () => {
  const { root, c } = await startSeeded({ FS_ALLOW_SECRETS: "1" });
  try {
    assert.match(await callText(c, "read_file", { path: ".env" }), /SECRET_TOKEN/);
  } finally {
    c.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("encoding: editing a CRLF file preserves CRLF line endings", async () => {
  const { root, c } = await startSeeded();
  try {
    await callText(c, "edit_file", { path: "crlf.txt", oldText: "two", newText: "TWO" });
    const raw = await fs.readFile(path.join(root, "crlf.txt"), "utf8");
    assert.ok(raw.includes("TWO"), "edit applied");
    assert.ok(raw.includes("\r\n"), "CRLF preserved");
    assert.ok(!/[^\r]\n/.test(raw), "no bare LF introduced");
  } finally {
    c.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("encoding: reading a binary file as text gives a clean error", async () => {
  const { root, c } = await startSeeded();
  try {
    assert.match(await callText(c, "read_file", { path: "bin.dat" }), /binary|not a text/i);
  } finally {
    c.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("audit: a mutation appends a record to FS_AUDIT_LOG", async () => {
  const auditFile = path.join(os.tmpdir(), `audit-${Date.now()}.log`);
  const { root, c } = await startSeeded({ FS_AUDIT_LOG: auditFile });
  try {
    await callText(c, "write_file", { path: "new.txt", content: "x\n" });
    const log = await fs.readFile(auditFile, "utf8");
    assert.match(log, /"tool":"write_file"/);
    assert.match(log, /"outcome":"ok"/);
  } finally {
    c.close();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(auditFile, { force: true });
  }
});

test("readonly: FS_READONLY hides all mutating tools", async () => {
  const { root, c } = await startSeeded({ FS_READONLY: "true" });
  try {
    const names = (await c.send("tools/list", {})).result.tools.map((t) => t.name);
    for (const w of ["write_file", "edit_file", "delete", "move", "zip"]) assert.ok(!names.includes(w), `${w} hidden`);
    assert.ok(names.includes("read_file"), "read tools present");
  } finally {
    c.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("regression: write → edit → read round-trip", async () => {
  const { root, c } = await startSeeded();
  try {
    await callText(c, "write_file", { path: "r.txt", content: "alpha\nbeta\n" });
    await callText(c, "edit_file", { path: "r.txt", oldText: "beta", newText: "gamma" });
    assert.match(await callText(c, "read_file", { path: "r.txt" }), /gamma/);
  } finally {
    c.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("startup: refuses to boot without FS_ROOTS", async () => {
  const proc = spawn("node", [SERVER], { env: { ...process.env, FS_ROOTS: "" }, stdio: ["pipe", "pipe", "ignore"] });
  const code = await new Promise((r) => proc.on("exit", r));
  assert.equal(code, 1);
});
