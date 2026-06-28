// Shared test helpers for the notes server: seed a vault + drive it over stdio.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

export const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));

export async function seed(dir) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "alpha.md"),
    "---\ntitle: Alpha Note\ntags: [project, mcp]\n---\n# Alpha Note\n\nLinks to [[beta]] and [[gamma]] plus a broken [[ghost]].\n\n## Tasks\n- [ ] write tests\n- [x] done thing\n",
  );
  await fs.writeFile(path.join(dir, "beta.md"), "---\ntags: work\n---\n# Beta\nA note about a kangaroo. Links [[gamma]].\n");
  await fs.writeFile(path.join(dir, "gamma.md"), "---\ntags: work\n---\n# Gamma\nMentions minisearch. Links [[alpha]].\n");
}

export function client(env) {
  const proc = spawn("node", [SERVER], { env: { ...process.env, NOTES_NO_CACHE: "1", ...env }, stdio: ["pipe", "pipe", "ignore"] });
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

export async function handshake(c) {
  await c.send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  c.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
}

export const callText = async (c, name, args = {}) => {
  const r = await c.send("tools/call", { name, arguments: args });
  return r.result?.content?.map((x) => x.text ?? `[${x.type}]`).join("\n") ?? JSON.stringify(r.error);
};

/** Start a server against a freshly seeded temp vault. Returns {dir, c}. */
export async function startSeeded(env = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-test-"));
  await seed(dir);
  const c = client({ NOTES_DIR: dir, ...env });
  await handshake(c);
  return { dir, c };
}
