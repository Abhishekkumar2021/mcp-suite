// Integration tests over stdio (no network): tool registration, readonly gating,
// and graceful unauthenticated behavior.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));

async function client(extraEnv) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ghtool-"));
  const env = { ...process.env, XDG_CONFIG_HOME: dir, ...extraEnv };
  delete env.GITHUB_TOKEN;
  delete env.GITHUB_PERSONAL_ACCESS_TOKEN;
  delete env.GITHUB_CLIENT_ID;
  Object.assign(env, extraEnv); // re-apply overrides after deletes
  const proc = spawn("node", [SERVER], { env, stdio: ["pipe", "pipe", "ignore"] });
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
  await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  return { proc, send, dir, close: () => proc.kill() };
}
const callText = async (c, name, args = {}) => {
  const r = await c.send("tools/call", { name, arguments: args });
  return r.result?.content?.map((x) => x.text).join("\n") ?? JSON.stringify(r.error);
};

test("tools/list includes the expected tools", async () => {
  const c = await client({});
  try {
    const names = (await c.send("tools/list", {})).result.tools.map((t) => t.name);
    for (const n of ["github_login", "whoami", "search_repos", "get_repo", "rate_limit", "create_issue"]) {
      assert.ok(names.includes(n), `${n} present`);
    }
  } finally {
    c.close();
    await fs.rm(c.dir, { recursive: true, force: true });
  }
});

test("GITHUB_READONLY hides write tools", async () => {
  const c = await client({ GITHUB_READONLY: "1" });
  try {
    const names = (await c.send("tools/list", {})).result.tools.map((t) => t.name);
    assert.ok(!names.includes("create_issue"));
    assert.ok(!names.includes("add_issue_comment"));
    assert.ok(names.includes("search_repos"));
  } finally {
    c.close();
    await fs.rm(c.dir, { recursive: true, force: true });
  }
});

test("unauthenticated tool call returns guidance, not a crash", async () => {
  const c = await client({});
  try {
    const t = await callText(c, "whoami");
    assert.match(t, /Not authenticated|github_login/i);
  } finally {
    c.close();
    await fs.rm(c.dir, { recursive: true, force: true });
  }
});

test("github_login without client_id or token explains setup", async () => {
  const c = await client({});
  try {
    assert.match(await callText(c, "github_login"), /OAuth App|GITHUB_CLIENT_ID|GITHUB_TOKEN/);
  } finally {
    c.close();
    await fs.rm(c.dir, { recursive: true, force: true });
  }
});
