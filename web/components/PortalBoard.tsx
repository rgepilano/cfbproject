"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { WatchButton } from "@/components/Watchlist";
import { type Candidate, comparePortalRows, DEFAULT_WEIGHTS, scoreCandidate, type PortalSortKey, type Weights } from "@/lib/portal-score";
import { money } from "@/lib/util";

const LABELS: Record<keyof Weights, string> = {
  quality: "Player quality",
  need: "Positional need",
  eligibility: "Eligibility left",
  fit: "Fit",
};

function fmtPct(v: number | null) {
  return v === null || v === undefined ? "—" : `${Math.round(100 * Number(v))}%`;
}

export function PortalBoard({ candidates, groups, season, team, initialSource = "" }: {
  candidates: Candidate[]; groups: string[]; season?: string; team?: string; initialSource?: string;
}) {
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [group, setGroup] = useState("");
  const [source, setSource] = useState(initialSource);
  const [limit, setLimit] = useState(50);
  const [sort, setSort] = useState<{ key: PortalSortKey; direction: "asc" | "desc" }>({ key: "score", direction: "desc" });
  const activeSort = sort;
  const columns: { key: PortalSortKey; label: string }[] = [
    { key: "rank", label: "#" }, { key: "player", label: "Player" }, { key: "position", label: "Pos" },
    { key: "current_team", label: "From" }, { key: "source", label: "Source" }, { key: "score", label: "Score" },
    { key: "quality", label: "Quality" }, { key: "need", label: "Need" }, { key: "eligibility_score", label: "Elig." },
    { key: "fit", label: "Fit" }, { key: "production_pct", label: "Production" }, { key: "usage_share", label: "Usage" },
    { key: "transfer_risk", label: "Transfer risk" }, { key: "nil_value", label: season ? `${season} NIL estimate` : "Est. NIL" },
    { key: "nil_forecast", label: `${candidates.find((c) => c.forecast_season)?.forecast_season ?? "Next season"} NIL estimate` },
    { key: "signing_nil_estimate", label: `${candidates.find((c) => c.signing_season)?.signing_season ?? "Next season"} NIL at ${team ?? "selected team"}` },
  ];

  function changeSort(key: PortalSortKey) {
    const direction = activeSort.key === key ? (activeSort.direction === "asc" ? "desc" : "asc")
      : ["rank", "player", "position", "current_team", "source"].includes(key) ? "asc" : "desc";
    setSort({ key, direction });
  }

  const ranked = useMemo(() => {
    return candidates
      .filter((c) => (!group || c.pos_group === group) && (!source || (source === "Committed" ? c.source.startsWith("Committed") : c.source === source)))
      .map((c) => ({ ...c, score: scoreCandidate(c, weights) }))
      .sort((a, b) => b.score - a.score)
      .map((c, index) => ({ ...c, rank: index + 1 }))
      .sort((a, b) => comparePortalRows(a, b, sort.key, sort.direction));
  }, [candidates, weights, group, source, sort]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4 dark:border-slate-800 dark:bg-slate-900">
        {(Object.keys(LABELS) as (keyof Weights)[]).map((k) => (
          <label key={k} className="text-sm">
            <div className="flex justify-between">
              <span>{LABELS[k]}</span>
              <span className="font-mono">{weights[k].toFixed(2)}</span>
            </div>
            <input
              type="range" min={0} max={1} step={0.05} value={weights[k]} className="w-full"
              onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })}
            />
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-3 md:col-span-4">
          <select className="rounded border px-2 py-1 text-sm dark:bg-slate-900" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">All positions</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select className="rounded border px-2 py-1 text-sm dark:bg-slate-900" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            <option>In portal (uncommitted)</option>
            <option>Committed</option>
            <option>Watch list (high transfer risk)</option>
          </select>
          <button className="rounded border px-2 py-1 text-sm" onClick={() => setWeights(DEFAULT_WEIGHTS)}>Reset weights</button>
          <span className="text-sm text-slate-500">{ranked.length} candidates</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-2 py-2" aria-sort={activeSort.key === column.key ? (activeSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" className="flex items-center gap-1 whitespace-nowrap uppercase hover:text-blue-600"
                    onClick={() => changeSort(column.key)} title={`Sort by ${column.label}`}>
                    {column.label}<span className="inline-block w-3" aria-hidden="true">{activeSort.key === column.key ? (activeSort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.slice(0, limit).map((c) => (
              <tr key={c.candidate_id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-2 py-1.5 text-slate-400">{c.rank}</td>
                <td className="px-2 py-1.5">
                  {c.athlete_id && (
                    <WatchButton kind="player" id={c.athlete_id} label={`${c.first_name} ${c.last_name}`}
                      sub={`${c.position} · ${c.current_team}`} href={`/players/${c.athlete_id}`} />
                  )}{" "}
                  {c.athlete_id ? (
                    <Link className="text-blue-600 hover:underline" href={`/players/${c.athlete_id}`}>{c.first_name} {c.last_name}</Link>
                  ) : `${c.first_name} ${c.last_name}`}
                </td>
                <td className="px-2 py-1.5">{c.position}</td>
                <td className="px-2 py-1.5">{c.current_team}</td>
                <td className="px-2 py-1.5 text-xs text-slate-500">{c.source.startsWith("In portal") ? "Portal" : c.source.startsWith("Committed") ? c.source.replace("Committed to ", "→ ") : "Watch"}</td>
                <td className="px-2 py-1.5 font-semibold">{c.score.toFixed(1)}</td>
                <td className="px-2 py-1.5">{fmtPct(c.quality)}</td>
                <td className="px-2 py-1.5">{fmtPct(c.need)}</td>
                <td className="px-2 py-1.5">{fmtPct(c.eligibility_score)}</td>
                <td className="px-2 py-1.5">{fmtPct(c.fit)}</td>
                <td className="px-2 py-1.5">{fmtPct(c.production_pct)}</td>
                <td className="px-2 py-1.5">{fmtPct(c.usage_share)}</td>
                <td className="px-2 py-1.5">{c.transfer_risk ?? "—"}</td>
                <td className="px-2 py-1.5">{money(c.nil_value)}</td>
                <td className="px-2 py-1.5" title={c.nil_forecast_drivers ?? ""}>{money(c.nil_forecast)}</td>
                <td className="px-2 py-1.5" title={c.signing_nil_drivers ?? ""}>{money(c.signing_nil_estimate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {limit < ranked.length && (
        <button className="rounded border px-3 py-1 text-sm" onClick={() => setLimit(limit + 50)}>Show more</button>
      )}
    </div>
  );
}
