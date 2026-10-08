"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { WatchButton } from "@/components/Watchlist";
import { type Candidate, DEFAULT_WEIGHTS, scoreCandidate, type Weights } from "@/lib/portal-score";
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

export function PortalBoard({ candidates, groups }: { candidates: Candidate[]; groups: string[] }) {
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [group, setGroup] = useState("");
  const [source, setSource] = useState("");
  const [limit, setLimit] = useState(50);

  const ranked = useMemo(() => {
    return candidates
      .filter((c) => (!group || c.pos_group === group) && (!source || c.source === source))
      .map((c) => ({ ...c, score: scoreCandidate(c, weights) }))
      .sort((a, b) => b.score - a.score);
  }, [candidates, weights, group, source]);

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
              {["#", "Player", "Pos", "From", "Source", "Score", "Quality", "Need", "Elig.", "Fit", "Production", "Usage", "Transfer risk", "Est. NIL"].map((h) => (
                <th key={h} className="px-2 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.slice(0, limit).map((c, i) => (
              <tr key={c.candidate_id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
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
                <td className="px-2 py-1.5 text-xs text-slate-500">{c.source.startsWith("In portal") ? "Portal" : "Watch"}</td>
                <td className="px-2 py-1.5 font-semibold">{c.score.toFixed(1)}</td>
                <td className="px-2 py-1.5">{fmtPct(c.quality)}</td>
                <td className="px-2 py-1.5">{fmtPct(c.need)}</td>
                <td className="px-2 py-1.5">{fmtPct(c.eligibility_score)}</td>
                <td className="px-2 py-1.5">{fmtPct(c.fit)}</td>
                <td className="px-2 py-1.5">{fmtPct(c.production_pct)}</td>
                <td className="px-2 py-1.5">{fmtPct(c.usage_share)}</td>
                <td className="px-2 py-1.5">{c.transfer_risk ?? "—"}</td>
                <td className="px-2 py-1.5">{money(c.nil_value)}</td>
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
