// Unit tests for the security core (sandbox.ts) — the most safety-critical module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setRoots, resolveInside, validateName, getRoots } from "../dist/sandbox.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "files-unit-"));
await fs.writeFile(path.join(root, "ok.txt"), "hi");
await fs.symlink("/etc", path.join(root, "escape")).catch(() => {});
await setRoots([root]);

test("setRoots canonicalizes and stores the root", () => {
  assert.equal(getRoots().length, 1);
});

test("resolveInside accepts a path inside the root", async () => {
  const abs = await resolveInside("ok.txt");
  assert.ok(abs.endsWith("ok.txt"));
});

test("resolveInside rejects traversal outside the root", async () => {
  await assert.rejects(() => resolveInside("../../../etc/passwd"), /outside|escape/i);
});

test("resolveInside rejects a symlink that escapes the sandbox", async () => {
  await assert.rejects(() => resolveInside("escape/passwd"), /symlink|outside/i);
});

test("validateName rejects control characters", () => {
  assert.throws(() => validateName("a\u0001b"), /control/i);
});

test("validateName rejects empty names", () => {
  assert.throws(() => validateName(""), /non-empty/i);
});

test.after?.(() => fs.rm(root, { recursive: true, force: true }));
