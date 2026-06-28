// Unit tests for the resilience guard (runtime.ts).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.FS_OP_TIMEOUT_MS = "20";
process.env.FS_MAX_CONCURRENCY = "4";
const { guard } = await import("../dist/runtime.js");

test("guard rejects an op that exceeds the timeout", async () => {
  await assert.rejects(() => guard(() => new Promise((r) => setTimeout(r, 300))), /timed out/i);
});

test("guard runs many queued ops without deadlock (semaphore handoff)", async () => {
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => guard(async () => i)));
  assert.equal(results.length, 30);
  assert.equal(results[29], 29);
});
