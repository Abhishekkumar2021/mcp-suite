// Shared test helpers: seed a temp root + drive the server over stdio JSON-RPC.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

export const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));

export async function mkRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "files-test-"));
}

export async function seed(root) {
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "README.md"), "# Project\nhello world\nthird line\n");
  await fs.writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\nconst kangaroo = true;\n");
  await fs.writeFile(path.join(root, "crlf.txt"), "one\r\ntwo\r\nthree\r\n");
  await fs.writeFile(path.join(root, ".env"), "SECRET_TOKEN=abc123\n");
  await fs.writeFile(path.join(root, "bin.dat"), Buffer.from([0x00, 0x01, 0x02, 0x6b]));
}

export function client(env) {
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

export async function handshake(c) {
  await c.send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  c.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
}

export async function call(c, name, args = {}) {
  const r = await c.send("tools/call", { name, arguments: args });
  if (r.result?.content) return r.result.content;
  return [{ type: "text", text: JSON.stringify(r.error) }];
}

export const callText = async (c, name, args = {}) =>
  (await call(c, name, args)).map((x) => x.text ?? `[${x.type}]`).join("\n");

/** Start a server against a freshly seeded temp root. Returns {root, c}. */
export async function startSeeded(env = {}) {
  const root = await mkRoot();
  await seed(root);
  const c = client({ FS_ROOTS: root, ...env });
  await handshake(c);
  return { root, c };
}
