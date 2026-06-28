// Unit tests for the auth core: token resolution + device flow (mocked fetch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getToken, login, logout, NotAuthenticatedError } from "../dist/auth.js";
import { getAuthFile } from "../dist/config.js";

// Each test runs against a fresh XDG config dir and clean token env.
async function freshEnv() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ghauth-"));
  process.env.XDG_CONFIG_HOME = dir;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  delete process.env.GITHUB_CLIENT_ID;
  return dir;
}

function mockFetch(handler) {
  globalThis.fetch = async (url, opts) => ({ json: async () => handler(String(url), opts) });
}

test("env PAT takes precedence", async () => {
  await freshEnv();
  process.env.GITHUB_TOKEN = "ghp_envtoken";
  assert.equal(await getToken(), "ghp_envtoken");
  delete process.env.GITHUB_TOKEN;
});

test("cached token is used when no env PAT", async () => {
  const dir = await freshEnv();
  await fs.mkdir(path.join(dir, "mcp-github"), { recursive: true });
  await fs.writeFile(getAuthFile(), JSON.stringify({ token: { access_token: "cached_tok" } }));
  assert.equal(await getToken(), "cached_tok");
});

test("expired token is refreshed", async () => {
  const dir = await freshEnv();
  process.env.GITHUB_CLIENT_ID = "cid";
  await fs.mkdir(path.join(dir, "mcp-github"), { recursive: true });
  await fs.writeFile(
    getAuthFile(),
    JSON.stringify({ token: { access_token: "old", refresh_token: "r1", expires_at: Date.now() - 1000 } }),
  );
  mockFetch((url) => (url.includes("access_token") ? { access_token: "refreshed_tok", expires_in: 3600 } : {}));
  assert.equal(await getToken(), "refreshed_tok");
});

test("no token anywhere throws NotAuthenticatedError", async () => {
  await freshEnv();
  await assert.rejects(() => getToken(), NotAuthenticatedError);
});

test("device flow: first call returns instructions, second authorizes", async () => {
  await freshEnv();
  process.env.GITHUB_CLIENT_ID = "cid";
  mockFetch((url) => {
    if (url.includes("device/code")) {
      return { device_code: "dc", user_code: "WXYZ-1234", verification_uri: "https://github.com/login/device", interval: 1, expires_in: 900 };
    }
    // Authorize on the first poll so the test doesn't sleep (pending/slow_down
    // branches are exercised by prod code; kept out of the test for speed).
    return { access_token: "device_tok", scope: "repo" };
  });

  const first = await login(50_000);
  assert.equal(first.state, "instructions");
  assert.match(first.message, /WXYZ-1234/);

  const second = await login(50_000);
  assert.equal(second.state, "authorized");
  assert.equal(await getToken(), "device_tok");

  // token file is owner-only (0600)
  const mode = (await fs.stat(getAuthFile())).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("logout clears the cached token", async () => {
  const dir = await freshEnv();
  await fs.mkdir(path.join(dir, "mcp-github"), { recursive: true });
  await fs.writeFile(getAuthFile(), JSON.stringify({ token: { access_token: "x" } }));
  await logout();
  await assert.rejects(() => getToken(), NotAuthenticatedError);
});
