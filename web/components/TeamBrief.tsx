"use client";

import { useState } from "react";
import type { TeamBriefResult } from "@/lib/team-brief";

export function TeamBrief({ team }: { team: string }) {
  const [result, setResult] = useState<TeamBriefResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate(force = false) {
    if (force && !window.confirm("Generate a fresh team brief? This may use a paid AI request.")) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/team-brief", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team, force }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate the team brief.");
      setResult(data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not generate the team brief.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="border-y border-slate-200 py-4 dark:border-slate-800" aria-label={`${team} team brief`} aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Team Brief · {team}</h2>
        <button type="button" disabled={loading} onClick={() => void generate(!!result)}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700">
          {loading ? "Generating brief..." : result ? "Regenerate Brief" : "Generate Brief"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
      {result && (
        <div className="mt-4 space-y-3 text-sm" aria-live="polite">
          <p className="font-medium">{result.brief.outlook}</p>
          <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            <div><dt className="font-semibold">Positional Needs · {result.dataBasis.positionalGroups} groups</dt><dd>{result.brief.positionalNeeds}</dd></div>
            <div><dt className="font-semibold">Retention · {result.dataBasis.retentionPlayers} players</dt><dd>{result.brief.retention}</dd></div>
            <div><dt className="font-semibold">2027 Commits · {result.dataBasis.commits}</dt><dd>{result.brief.commits}</dd></div>
            <div><dt className="font-semibold">Portal Fits · {result.dataBasis.portalFits}</dt><dd>{result.brief.portal}</dd></div>
            <div><dt className="font-semibold">NIL Planning</dt><dd>{result.brief.nil}</dd></div>
          </dl>
          <div>
            <h3 className="font-semibold">Staff Actions</h3>
            <ul className="list-disc space-y-1 pl-5">{result.brief.actions.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </div>
          <p className="text-xs text-slate-500">{result.model} · {new Date(result.generatedAt).toLocaleString()} · {result.cached ? "Saved brief" : "New brief"}</p>
        </div>
      )}
    </section>
  );
}