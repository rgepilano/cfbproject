"use client";

import Link from "next/link";
import { useWatchlist } from "@/components/Watchlist";

export default function WatchlistPage() {
  const { items, remove } = useWatchlist();
  const groups = [
    { title: "Players", rows: items.filter((i) => i.kind === "player") },
    { title: "Recruits", rows: items.filter((i) => i.kind === "recruit") },
  ];
  return (
    <>
      <h1 className="text-2xl font-bold">Watchlist</h1>
      <p className="text-sm text-slate-500">Saved in this browser. Star players on the Retention, Portal, Recruits, or player pages.</p>
      {groups.map((g) => (
        <section key={g.title} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-2 font-semibold">{g.title} ({g.rows.length})</h2>
          {g.rows.length === 0 ? (
            <p className="text-sm text-slate-500">None yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {g.rows.map((i) => (
                <li key={i.key} className="flex items-center justify-between py-1.5 text-sm">
                  <span>
                    {i.href ? <Link className="text-blue-600 hover:underline" href={i.href}>{i.label}</Link> : i.label}
                    {i.sub && <span className="ml-2 text-slate-500">{i.sub}</span>}
                  </span>
                  <button className="text-xs text-red-600" onClick={() => remove(i.key)}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
