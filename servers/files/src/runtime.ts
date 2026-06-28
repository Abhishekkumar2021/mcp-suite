/**
 * Runtime guards for every tool handler: a concurrency semaphore (so a burst of
 * calls can't spawn unbounded fs work) and a per-operation timeout (so a slow or
 * stuck disk/op surfaces an error instead of hanging the server).
 */
import { maxConcurrency, opTimeoutMs } from "./config.js";

let active = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < maxConcurrency()) {
    active++;
    return;
  }
  // At capacity: wait for a slot to be handed over (active count is preserved).
  await new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) next(); // hand the slot directly to the next waiter (active unchanged)
  else active--;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms.`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Run `fn` under the concurrency limit and operation timeout. */
export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await withTimeout(fn(), opTimeoutMs());
  } finally {
    release();
  }
}
