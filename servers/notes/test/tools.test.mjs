// Integration tests over stdio for the notes server.
// NOTE: semantic_search is intentionally NOT tested here — it downloads an
// embedding model on first use, which isn't CI-friendly. It has a separate
// manual smoke check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { startSeeded, callText } from "./_helpers.mjs";

async function withVault(env, fn) {
  const { dir, c } = await startSeeded(env);
  try {
    await fn(c, dir);
  } finally {
    c.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("search_notes ranks a keyword hit", async () => {
  await withVault({}, async (c) => {
    assert.match(await callText(c, "search_notes", { query: "kangaroo" }), /beta/);
  });
});

test("list_tags counts tags", async () => {
  await withVault({}, async (c) => {
    const t = await callText(c, "list_tags");
    assert.match(t, /work \(2\)/);
    assert.match(t, /project \(1\)/);
  });
});

test("list_todos shows open, hides done", async () => {
  await withVault({}, async (c) => {
    const t = await callText(c, "list_todos");
    assert.match(t, /write tests/);
    assert.doesNotMatch(t, /done thing/);
  });
});

test("get_outline + read_note section", async () => {
  await withVault({}, async (c) => {
    assert.match(await callText(c, "get_outline", { name: "alpha" }), /Tasks/);
    const sec = await callText(c, "read_note", { name: "alpha", section: "Tasks" });
    assert.match(sec, /write tests/);
    assert.doesNotMatch(sec, /Links to/);
  });
});

test("knowledge graph: neighbors, path, related, overview, broken_links", async () => {
  await withVault({}, async (c) => {
    const nb = await callText(c, "get_neighbors", { name: "alpha", depth: 1 });
    assert.match(nb, /beta/);
    assert.match(nb, /gamma/);
    assert.match(await callText(c, "find_path", { from: "beta", to: "alpha" }), /alpha/);
    assert.match(await callText(c, "related_notes", { name: "beta" }), /gamma/);
    const overview = await callText(c, "graph_overview");
    assert.match(overview, /Notes: 3/);
    assert.match(overview, /Broken links: 1/);
    assert.match(await callText(c, "broken_links"), /ghost/);
  });
});

test("move_note rewrites backlinks", async () => {
  await withVault({}, async (c, dir) => {
    assert.match(await callText(c, "move_note", { from: "alpha", to: "alpha-renamed" }), /gamma/);
    const gamma = await fs.readFile(`${dir}/gamma.md`, "utf8");
    assert.match(gamma, /\[\[alpha-renamed\]\]/);
    assert.doesNotMatch(gamma, /\[\[alpha\]\]/);
  });
});

test("read-only mode hides mutating tools", async () => {
  await withVault({ NOTES_READONLY: "1" }, async (c) => {
    const names = (await c.send("tools/list", {})).result.tools.map((t) => t.name);
    for (const w of ["create_note", "append_note", "delete_note", "move_note"]) assert.ok(!names.includes(w), `${w} hidden`);
    assert.ok(names.includes("search_notes"));
  });
});
