// Self-contained: build a real repo with isomorphic-git, then drive the server
// over stdio. No system git needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import git from "isomorphic-git";
import { redact } from "../dist/repo.js";
import { getGitToken } from "../dist/config.js";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const author = { name: "Test", email: "test@example.com" };

/** Create a temp repo with one commit, a branch, and a varied working tree. */
async function makeRepo() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gitmcp-"));
  await git.init({ fs, dir, defaultBranch: "main" });
  await fsp.mkdir(path.join(dir, "src"), { recursive: true });
  await fsp.writeFile(path.join(dir, "README.md"), "# Project\nhello\n");
  await fsp.writeFile(path.join(dir, "src", "a.txt"), "alpha\n");
  await git.add({ fs, dir, filepath: "README.md" });
  await git.add({ fs, dir, filepath: "src/a.txt" });
  await git.commit({ fs, dir, message: "initial commit", author });
  await git.branch({ fs, dir, ref: "feature" });
  await git.addRemote({ fs, dir, remote: "origin", url: "https://example.com/repo.git" });
  // working-tree variety:
  await fsp.writeFile(path.join(dir, "README.md"), "# Project\nhello world\n"); // modified, unstaged
  await fsp.writeFile(path.join(dir, "staged.txt"), "new file\n");
  await git.add({ fs, dir, filepath: "staged.txt" }); // staged, new
  await fsp.writeFile(path.join(dir, "untracked.txt"), "u\n"); // untracked
  return dir;
}

function client(env) {
  const proc = spawn("node", [SERVER], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "ignore"] });
  const rl = readline.createInterface({ input: proc.stdout });
  const pending = new Map();
  let id = 0;
  rl.on("line", (l) => {
    let m;
    try {
      m = JSON.parse(l);
    } catch {
      return;
    }
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
    });
  return { proc, send, close: () => proc.kill() };
}
async function start(env) {
  const c = client(env);
  await c.send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  c.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  return c;
}
const callText = async (c, name, args = {}) => {
  const r = await c.send("tools/call", { name, arguments: args });
  return r.result?.content?.map((x) => x.text).join("\n") ?? JSON.stringify(r.error);
};

test("read tools: status / log / diff / show / read_file_at / branches / search", async () => {
  const dir = await makeRepo();
  const c = await start({ GIT_ROOTS: dir });
  try {
    const status = JSON.parse(await callText(c, "git_status", { repo: "." }));
    assert.deepEqual(status.staged, ["staged.txt"]);
    assert.deepEqual(status.unstaged, ["README.md"]);
    assert.deepEqual(status.untracked, ["untracked.txt"]);
    assert.equal(status.branch, "main");

    const logRows = JSON.parse(await callText(c, "git_log", { repo: "." }));
    assert.equal(logRows.length, 1);
    assert.match(logRows[0].message, /initial commit/);

    const diff = await callText(c, "git_diff", { repo: "." });
    assert.match(diff, /MODIFY README\.md/);
    assert.match(diff, /hello world/);

    const show = JSON.parse(await callText(c, "git_show", { repo: ".", oid: logRows[0].oid }));
    assert.ok(show.files.some((f) => f.path === "README.md") || show.files.length >= 1);

    assert.match(await callText(c, "read_file_at", { repo: ".", path: "README.md", ref: "HEAD" }), /hello\n/);
    assert.match(await callText(c, "list_branches", { repo: "." }), /feature/);
    assert.equal(await callText(c, "current_branch", { repo: "." }), "main");
    assert.match(await callText(c, "search_log", { repo: ".", query: "initial" }), /initial commit/);

    const hist = JSON.parse(await callText(c, "git_file_history", { repo: ".", path: "src/a.txt" }));
    assert.equal(hist.length, 1);
  } finally {
    c.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("write tools are gated by GIT_WRITABLE", async () => {
  const dir = await makeRepo();
  const ro = await start({ GIT_ROOTS: dir });
  try {
    const names = (await ro.send("tools/list", {})).result.tools.map((t) => t.name);
    for (const w of ["git_stage", "git_commit", "git_checkout"]) assert.ok(!names.includes(w), `${w} hidden`);
  } finally {
    ro.close();
  }
  const rw = await start({ GIT_ROOTS: dir, GIT_WRITABLE: "1" });
  try {
    const names = (await rw.send("tools/list", {})).result.tools.map((t) => t.name);
    assert.ok(names.includes("git_commit"));
    // stage the untracked file, commit it, confirm log grows
    await callText(rw, "git_stage", { repo: ".", path: "untracked.txt" });
    const committed = JSON.parse(await callText(rw, "git_commit", { repo: ".", message: "add untracked", name: "T", email: "t@e.com" }));
    assert.ok(committed.oid);
    const logRows = JSON.parse(await callText(rw, "git_log", { repo: "." }));
    assert.equal(logRows.length, 2);
    assert.match(logRows[0].message, /add untracked/);
  } finally {
    rw.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("remote: list_remotes always; clone/fetch/push gated by GIT_WRITABLE", async () => {
  const dir = await makeRepo();
  const ro = await start({ GIT_ROOTS: dir });
  try {
    const names = (await ro.send("tools/list", {})).result.tools.map((t) => t.name);
    assert.ok(names.includes("list_remotes"), "list_remotes always available");
    for (const w of ["git_clone", "git_fetch", "git_pull", "git_push"]) assert.ok(!names.includes(w), `${w} gated`);
    assert.match(await callText(ro, "list_remotes", { repo: "." }), /origin/);
    assert.match(await callText(ro, "list_remotes", { repo: "." }), /example\.com/);
  } finally {
    ro.close();
  }
  const rw = await start({ GIT_ROOTS: dir, GIT_WRITABLE: "1" });
  try {
    const names = (await rw.send("tools/list", {})).result.tools.map((t) => t.name);
    for (const w of ["git_clone", "git_fetch", "git_pull", "git_push"]) assert.ok(names.includes(w), `${w} present when writable`);
  } finally {
    rw.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("redact strips token patterns; token resolution prefers GIT_TOKEN then GITHUB_TOKEN", () => {
  assert.doesNotMatch(redact("fatal: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"), /ghp_ABCDEF/);
  delete process.env.GIT_TOKEN;
  delete process.env.GITHUB_TOKEN;
  assert.equal(getGitToken(), undefined);
  process.env.GITHUB_TOKEN = "fallback_tok";
  assert.equal(getGitToken(), "fallback_tok");
  process.env.GIT_TOKEN = "primary_tok";
  assert.equal(getGitToken(), "primary_tok");
  delete process.env.GIT_TOKEN;
  delete process.env.GITHUB_TOKEN;
});

test("security: repo outside roots rejected; no roots refuses to start", async () => {
  const dir = await makeRepo();
  const c = await start({ GIT_ROOTS: dir });
  try {
    assert.match(await callText(c, "git_status", { repo: "../../../etc" }), /Error|outside/i);
  } finally {
    c.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
  const proc = spawn("node", [SERVER], { env: { ...process.env, GIT_ROOTS: "" }, stdio: ["pipe", "pipe", "ignore"] });
  const code = await new Promise((r) => proc.on("exit", r));
  assert.equal(code, 1);
});
