// File-backed JSON maps for the native relay (same demo-grade pattern as the
// leaderboard: data/*.json, gitignored, write-through cache). Survives server
// restarts; not for multi-replica use — swap for KV before real users.

import { promises as fs } from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "native");
const cache = new Map<string, Record<string, unknown>>();

async function filePath(name: string): Promise<string> {
  await fs.mkdir(DIR, { recursive: true });
  return path.join(DIR, `${name}.json`);
}

async function load(name: string): Promise<Record<string, unknown>> {
  const hit = cache.get(name);
  if (hit) return hit;
  try {
    const raw = await fs.readFile(await filePath(name), "utf8");
    const v: unknown = JSON.parse(raw);
    const obj = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
    cache.set(name, obj);
    return obj;
  } catch {
    const obj: Record<string, unknown> = {};
    cache.set(name, obj);
    return obj;
  }
}

async function save(name: string, obj: Record<string, unknown>): Promise<void> {
  cache.set(name, obj);
  try {
    await fs.writeFile(await filePath(name), JSON.stringify(obj));
  } catch {
    // Reads stay live from cache; a failed write is retried on next save.
  }
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
