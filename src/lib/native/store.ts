// File-backed JSON maps for the native relay (same demo-grade pattern as the
// leaderboard: data/*.json, gitignored, write-through cache). Survives server
// restarts; not for multi-replica use — swap for KV before real users.

import { promises as fs } from "node:fs";
import path from "node:path";

const DIR = process.env.CODELIT_NATIVE_DATA_DIR || path.join(process.cwd(), "data", "native");
const cache = new Map<string, Record<string, unknown>>();
const loading = new Map<string, Promise<Record<string, unknown>>>();
const writes = new Map<string, Promise<void>>();

async function filePath(name: string): Promise<string> {
  await fs.mkdir(DIR, { recursive: true });
  return path.join(DIR, `${name}.json`);
}

async function load(name: string): Promise<Record<string, unknown>> {
  const hit = cache.get(name);
  if (hit) return hit;
  const pending = loading.get(name);
  if (pending) return pending;
  const request = read(name);
  loading.set(name, request);
  try { return await request; } finally { loading.delete(name); }
}

async function read(name: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(await filePath(name), "utf8");
    const v: unknown = JSON.parse(raw);
    const obj = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
    cache.set(name, obj);
    return obj;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const obj: Record<string, unknown> = {};
    cache.set(name, obj);
    return obj;
  }
}

async function save(name: string, obj: Record<string, unknown>): Promise<void> {
  cache.set(name, obj);
  const raw = JSON.stringify(obj);
  const next = (writes.get(name) || Promise.resolve()).catch(() => undefined).then(async () => {
    const target = await filePath(name);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, raw, { mode: 0o600 });
    await fs.rename(temporary, target);
  });
  writes.set(name, next);
  try { await next; } finally { if (writes.get(name) === next) writes.delete(name); }
}

export async function storeGet<T>(store: string, key: string): Promise<T | null> {
  const obj = await load(store);
  const v = obj[key];
  return (v === undefined ? null : v) as T | null;
}

export async function storeSet(store: string, key: string, value: unknown): Promise<void> {
  const obj = await load(store);
  obj[key] = value;
  await save(store, obj);
}

export async function storeDelete(store: string, key: string): Promise<void> {
  const obj = await load(store);
  delete obj[key];
  await save(store, obj);
}

export async function storeList<T>(store: string): Promise<T[]> {
  const obj = await load(store);
  return Object.values(obj) as T[];
}
