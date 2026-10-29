"use client";
import { useEffect, useState } from "react";

const NAME_KEY = "codelit:name";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function useLocal<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    // External-system sync (localStorage), deferred to a callback.
    const t = setTimeout(() => setValue(read(key, fallback)), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = (v: T) => {
    setValue(v);
    write(key, v);
  };
  return [value, set] as const;
}

export function getName(): string {
  return read(NAME_KEY, "");
}
export function setName(name: string) {
  write(NAME_KEY, name);
}


