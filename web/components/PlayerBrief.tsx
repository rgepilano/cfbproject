"use client";

import { useState } from "react";
import type { BriefResult } from "@/lib/player-brief";

export function PlayerBrief({ id, team }: { id: string; team: string }) {
  const [result, setResult] = useState<BriefResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/player-brief", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate the brief.");
      setResult(data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not generate the brief.");
    } finally { setLoading(false); }
  }

  return (
    <section className="border-y border-slate-200 py-4 dark:border-slate-800" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Player Brief · {team}</h2>
        <button type="button" onClick={generate} disabled={loading}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700">
          {loading ? "Generating brief..." : result ? "Refresh Brief" : "Generate Brief"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
      {result && (
        <div className="mt-4 space-y-3 text-sm" aria-live="polite">
          <p>{result.brief.assessment}</p>
          <ul className="list-disc space-y-1 pl-5">{result.brief.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul>
          <div><h3 className="font-semibold">Team Fit</h3><p>{result.brief.fit}</p></div>
          <div><h3 className="font-semibold">NIL Outlook</h3><p>{result.brief.nil}</p></div>
          <div><h3 className="font-semibold">Uncertainties</h3>
            <ul className="list-disc space-y-1 pl-5">{result.brief.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
          <div><h3 className="font-semibold">Decision Considerations</h3>
            <ul className="list-disc space-y-1 pl-5">{result.brief.considerations.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
          <p className="text-xs text-slate-500">AI-generated · {new Date(result.generatedAt).toLocaleString()} · {result.cached ? "Saved brief" : "New brief"}</p>
        </div>
      )}
    </section>
  );
}