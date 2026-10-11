"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWatchlist } from "@/components/Watchlist";
import { money } from "@/lib/util";

export default function WatchlistPage() {
  const { items, remove } = useWatchlist();
  const [nil, setNil] = useState<Record<string, number | null>>({});
  const [forecast, setForecast] = useState<Record<string, { nil_forecast: number; forecast_season: number; nil_forecast_drivers: string }>>({});
  const playerIds = items.filter((i) => i.kind === "player").map((i) => i.id).join(",");
  useEffect(() => {
    if (!playerIds) return;
    fetch(`/api/nil?ids=${encodeURIComponent(playerIds)}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then(setNil)
      .catch(() => {});
    fetch(`/api/nil?forecast=1&ids=${encodeURIComponent(playerIds)}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then(setForecast)
      .catch(() => {});
  }, [playerIds]);
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
                    {i.kind === "player" && i.id in nil && (
                      <span className="ml-2 text-slate-500">· Est. NIL {money(nil[i.id])}</span>
                    )}
                    {i.kind === "player" && forecast[i.id] && (
                      <span className="ml-2 text-slate-500" title={forecast[i.id].nil_forecast_drivers}>· {forecast[i.id].forecast_season} NIL estimate {money(forecast[i.id].nil_forecast)}</span>
                    )}
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
