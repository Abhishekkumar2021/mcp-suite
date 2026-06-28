// Unit tests for the hand-rolled markdown parser (parse.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseNote,
  extractWikiLinks,
  extractTodos,
  extractHeadings,
  extractSection,
  extractTags,
} from "../dist/parse.js";

const SAMPLE = `---
title: My Note
tags: [project, ideas]
---
# My Note

Body links [[other]] and [[aliased|Alias]]. Inline #tag here.

## Section A
content A
- [ ] open todo
- [x] done todo

## Section B
content B
`;

test("parseNote extracts frontmatter title + tags", () => {
  const p = parseNote(SAMPLE);
  assert.equal(p.title, "My Note");
  assert.ok(p.tags.includes("project"));
  assert.ok(p.tags.includes("ideas"));
  assert.ok(p.tags.includes("tag"), "inline #tag collected");
});

test("parseNote extracts wiki-link targets (alias stripped)", () => {
  const p = parseNote(SAMPLE);
  assert.deepEqual(p.links, ["other", "aliased"]);
});

test("extractWikiLinks dedupes and strips aliases", () => {
  assert.deepEqual(extractWikiLinks("[[a]] [[a]] [[b|B]]"), ["a", "b"]);
});

test("extractHeadings returns levels + text", () => {
  const hs = extractHeadings("# Top\n## Sub\n### Deep");
  assert.deepEqual(hs.map((h) => h.level), [1, 2, 3]);
  assert.equal(hs[1].text, "Sub");
});

test("extractSection returns just that heading's block", () => {
  const body = parseNote(SAMPLE).body;
  const a = extractSection(body, "Section A");
  assert.ok(a.includes("content A"));
  assert.ok(!a.includes("content B"));
});

test("extractTodos flags open vs done", () => {
  const todos = extractTodos("- [ ] open\n- [x] closed");
  assert.equal(todos.length, 2);
  assert.equal(todos[0].done, false);
  assert.equal(todos[1].done, true);
});

test("extractTags merges frontmatter + inline hashtags", () => {
  const tags = extractTags({ tags: ["fm"] }, "body #inline and #another");
  assert.ok(tags.includes("fm") && tags.includes("inline") && tags.includes("another"));
});
