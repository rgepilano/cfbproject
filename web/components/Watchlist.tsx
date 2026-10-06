"use client";

import { useSyncExternalStore } from "react";

export type WatchItem = { key: string; kind: "player" | "recruit"; id: string; label: string; sub?: string; href?: string };

const STORAGE_KEY = "cfb_watchlist";
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
