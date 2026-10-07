"use client";

import React, { useSyncExternalStore } from "react";

export type WatchItem = { key: string; kind: "player" | "recruit"; id: string; label: string; sub?: string; href?: string };

// Storage key is namespaced per-user when available: `cfb_watchlist:<username>`
let STORAGE_KEY = "cfb_watchlist";

export function setWatchlistKeyForUser(username: string | null) {
  const oldKey = STORAGE_KEY;
  const newKey = username ? `cfb_watchlist:${username}` : "cfb_watchlist";
  if (oldKey === newKey) return;
  try {
    const oldRaw = localStorage.getItem(oldKey);
    const newRaw = localStorage.getItem(newKey);
    // If there are items under the old key and none under the new key, migrate them.
    if (oldRaw && !newRaw) localStorage.setItem(newKey, oldRaw);
  } catch {
    // ignore storage errors
  }
  STORAGE_KEY = newKey;
  // invalidate cache so listeners re-read under the new key
  cache.raw = null;
  listeners.forEach((l) => l());
}
const listeners = new Set<() => void>();
let cache: { raw: string | null; items: WatchItem[] } = { raw: null, items: [] };

function read(): WatchItem[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw !== cache.raw) {
    try {
      cache = { raw, items: raw ? (JSON.parse(raw) as WatchItem[]) : [] };
    } catch {
      cache = { raw, items: [] };
    }
  }
  return cache.items;
}

function write(items: WatchItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

const EMPTY: WatchItem[] = [];

export function useWatchlist() {
  const items = useSyncExternalStore(subscribe, read, () => EMPTY);
  // Try to discover logged-in user and namespace the storage key accordingly.
  // This keeps existing behavior for anonymous users (shared local storage) but
  // switches to per-user keys when authenticated.
  // Run init as a side-effect to avoid doing async work during render.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  React.useEffect(() => {
    ReactTryInit();
  }, []);
  return {
    items,
    has: (key: string) => items.some((i) => i.key === key),
    toggle: (item: WatchItem) =>
      write(items.some((i) => i.key === item.key) ? items.filter((i) => i.key !== item.key) : [...items, item]),
    remove: (key: string) => write(items.filter((i) => i.key !== key)),
  };
}

export function WatchButton(props: Omit<WatchItem, "key">) {
  const key = `${props.kind}:${props.id}`;
  const { has, toggle } = useWatchlist();
  const on = has(key);
  return (
    <button
      type="button"
      title={on ? "Remove from watchlist" : "Add to watchlist"}
      aria-pressed={on}
      onClick={() => toggle({ ...props, key })}
      className={on ? "text-amber-500" : "text-slate-300 hover:text-amber-400"}
    >
      ★
    </button>
  );
}

// Implementation detail: run a one-time fetch to `/api/me` to get the username,
// and call `setWatchlistKeyForUser` so the hook uses a per-user key.
let initiated = false;
function ReactTryInit() {
  if (initiated) return;
  initiated = true;
  // Run async in background
  void (async () => {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) return;
      const data = await res.json();
      if (data?.username) setWatchlistKeyForUser(String(data.username));
    } catch {
      // ignore
    }
  })();
}
