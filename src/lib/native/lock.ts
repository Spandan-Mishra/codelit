// Mutations in the single-process demo cannot spend the same state twice.
const tails = new Map<string, Promise<unknown>>();

export async function withNativeLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) || Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  tails.set(key, next);
  try { return await next; }
  finally { if (tails.get(key) === next) tails.delete(key); }
}
