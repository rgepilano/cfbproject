"use client";

import { useState, type FormEvent } from "react";
import type { BriefResult } from "@/lib/player-brief";

type Scenario = "retention" | "acquisition";
type FollowUp = { item: string; owner: string; note: string; status: "open" | "verified"; updatedAt: string };

export function PlayerBrief({ id, team, playerTeam, teams }: { id: string; team: string; playerTeam: string; teams: string[] }) {
  const [selectedTeam, setSelectedTeam] = useState(team);
  const [scenario, setScenario] = useState<Scenario>(playerTeam.toLowerCase() === team.toLowerCase() ? "retention" : "acquisition");
  const [result, setResult] = useState<BriefResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [followupError, setFollowupError] = useState("");
  const [followups, setFollowups] = useState<FollowUp[]>([]);
  const [followupItem, setFollowupItem] = useState("");
  const [followupOwner, setFollowupOwner] = useState("");
  const [followupNote, setFollowupNote] = useState("");
  const [followupStatus, setFollowupStatus] = useState<FollowUp["status"]>("open");

  const canRetain = selectedTeam.toLowerCase() === playerTeam.toLowerCase();
  const followupOptions = result
    ? [...new Set([...result.brief.uncertainties, ...result.brief.considerations])]
    : [];

  function clearBrief() {
    setResult(null);
    setFollowups([]);
    setFollowupItem("");
    setFollowupOwner("");
    setFollowupNote("");
    setFollowupStatus("open");
    setFollowupError("");
  }

  async function loadFollowups(targetTeam: string, targetScenario: Scenario) {
    const query = new URLSearchParams({ id, team: targetTeam, scenario: targetScenario });
    const response = await fetch(`/api/player-brief/followups?${query}`);
    if (!response.ok) throw new Error("Could not load staff follow-ups.");
    const data = await response.json();
    setFollowups(data.items ?? []);
  }

  async function generate(force = false) {
    if (force && !window.confirm("Generate a new brief? This may use a paid AI request.")) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/player-brief", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, team: selectedTeam, scenario, force }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate the brief.");
      setResult(data);
      const options = [...new Set([...data.brief.uncertainties, ...data.brief.considerations])];
      setFollowupItem(options[0] ?? "");
      try {
        await loadFollowups(selectedTeam, scenario);
      } catch (failure) {
        setFollowupError(failure instanceof Error ? failure.message : "Could not load staff follow-ups.");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not generate the brief.");
    } finally { setLoading(false); }
  }

  async function saveFollowup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFollowupError("");
    try {
      const response = await fetch("/api/player-brief/followups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, team: selectedTeam, scenario, item: followupItem,
          owner: followupOwner, note: followupNote, status: followupStatus }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the follow-up.");
      setFollowups((current) => [data.item, ...current.filter((item) => item.item !== data.item.item)]);
      setFollowupOwner("");
      setFollowupNote("");
      setFollowupStatus("open");
    } catch (failure) {
      setFollowupError(failure instanceof Error ? failure.message : "Could not save the follow-up.");
    }
  }

  return (
    <section className="border-y border-slate-200 py-4 dark:border-slate-800" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Player Brief · {selectedTeam}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm" htmlFor={`brief-team-${id}`}>Compare with</label>
          <select id={`brief-team-${id}`} value={selectedTeam} disabled={loading}
            onChange={(event) => {
              const nextTeam = event.target.value;
              setSelectedTeam(nextTeam);
              setScenario(nextTeam.toLowerCase() === playerTeam.toLowerCase() ? "retention" : "acquisition");
              clearBrief();
            }}
            className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950">
            {teams.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded border border-slate-300 dark:border-slate-700" role="group" aria-label="Brief scenario">
          <button type="button" aria-pressed={scenario === "retention"} disabled={loading || !canRetain}
            onClick={() => { setScenario("retention"); clearBrief(); }}
            className="border-r border-slate-300 px-3 py-1.5 text-sm aria-pressed:bg-slate-200 disabled:opacity-40 dark:border-slate-700 dark:aria-pressed:bg-slate-800">
            Retention
          </button>
          <button type="button" aria-pressed={scenario === "acquisition"} disabled={loading}
            onClick={() => { setScenario("acquisition"); clearBrief(); }}
            className="px-3 py-1.5 text-sm aria-pressed:bg-slate-200 dark:aria-pressed:bg-slate-800">
            Acquisition
          </button>
        </div>
        <button type="button" onClick={() => void generate(!!result)} disabled={loading}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700">
          {loading ? "Generating brief..." : result ? "Regenerate Brief" : "Generate Brief"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
      {result && (
        <div className="mt-4 space-y-3 text-sm" aria-live="polite">
          <p>{result.brief.assessment}</p>
          <div><h3 className="font-semibold">Roster Context</h3>
            <ul className="list-disc space-y-1 pl-5">{result.brief.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
          <div><h3 className="font-semibold">Position-Room Outlook</h3><p>{result.brief.fit}</p></div>
          <div><h3 className="font-semibold">NIL Planning</h3><p>{result.brief.nil}</p></div>
          <div><h3 className="font-semibold">What To Verify</h3>
            <ul className="list-disc space-y-1 pl-5">{result.brief.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
          <div><h3 className="font-semibold">Staff Priorities</h3>
            <ul className="list-disc space-y-1 pl-5">{result.brief.considerations.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
          <details className="border-t border-slate-200 pt-3 dark:border-slate-800">
            <summary className="cursor-pointer font-semibold">Data basis</summary>
            <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <div><dt className="text-slate-500">Scenario</dt><dd>{result.scenario === "retention" ? "Retention at current team" : `Hypothetical acquisition by ${result.team}`}</dd></div>
              <div><dt className="text-slate-500">Player data</dt><dd>{result.dataBasis.positionGroup ?? "Position unknown"}; latest {result.dataBasis.playerSeason ?? "—"} season; history {result.dataBasis.recentSeasons.join(", ") || "unavailable"}</dd></div>
              <div><dt className="text-slate-500">Position room sample</dt><dd>{result.team} · {result.dataBasis.positionGroup ?? "position unknown"}: up to {result.dataBasis.returningPlayers} returning-player projections and {result.dataBasis.incomingCommits} next-class commits</dd></div>
              <div><dt className="text-slate-500">Projection horizon</dt><dd>{result.dataBasis.rosterProjectionSeason ?? "Unavailable"}</dd></div>
              <div><dt className="text-slate-500">Signing NIL scenario</dt><dd>{result.dataBasis.signingEstimateAvailable ? "Estimate available" : "No estimate available"}</dd></div>
              <div><dt className="text-slate-500">Brief source</dt><dd>{result.model} · {new Date(result.generatedAt).toLocaleString()} · {result.cached ? "Saved brief" : "Generated brief"}</dd></div>
            </dl>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <a className="text-blue-700 underline dark:text-blue-400" href="#player-seasons">Player season history</a>
              <a className="text-blue-700 underline dark:text-blue-400" href={`/pipeline?team=${encodeURIComponent(result.team)}`}>Full position-room pipeline</a>
            </p>
          </details>
          <section className="border-t border-slate-200 pt-3 dark:border-slate-800">
            <h3 className="font-semibold">Staff Follow-up</h3>
            <form onSubmit={saveFollowup} className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-slate-600 dark:text-slate-400" htmlFor={`followup-item-${id}`}>Brief item
                <select id={`followup-item-${id}`} required value={followupItem} onChange={(event) => setFollowupItem(event.target.value)}
                  className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                  {followupOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-600 dark:text-slate-400" htmlFor={`followup-owner-${id}`}>Owner
                <input id={`followup-owner-${id}`} maxLength={100} value={followupOwner} onChange={(event) => setFollowupOwner(event.target.value)}
                  placeholder="Position coach, GM, operations..."
                  className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
              </label>
              <label className="text-xs text-slate-600 dark:text-slate-400" htmlFor={`followup-note-${id}`}>Staff note
                <input id={`followup-note-${id}`} maxLength={2000} value={followupNote} onChange={(event) => setFollowupNote(event.target.value)}
                  className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
              </label>
              <div className="flex items-end gap-2">
                <label className="text-xs text-slate-600 dark:text-slate-400" htmlFor={`followup-status-${id}`}>Status
                  <select id={`followup-status-${id}`} value={followupStatus} onChange={(event) => setFollowupStatus(event.target.value as FollowUp["status"])}
                    className="mt-1 block rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                    <option value="open">Open</option><option value="verified">Verified</option>
                  </select>
                </label>
                <button type="submit" disabled={!followupItem} className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700">Save follow-up</button>
              </div>
            </form>
            {followupError && <p className="mt-2 text-sm text-red-600" role="alert">{followupError}</p>}
            {followups.length > 0 && <ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">
              {followups.map((item) => <li key={item.item} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div><p>{item.item}</p><p className="text-xs text-slate-500">{item.status === "verified" ? "Verified" : "Open"}{item.owner ? ` · ${item.owner}` : ""}{item.note ? ` · ${item.note}` : ""}</p></div>
                <button type="button" className="text-xs underline" onClick={() => {
                  setFollowupItem(item.item); setFollowupOwner(item.owner); setFollowupNote(item.note); setFollowupStatus(item.status);
                }}>Edit</button>
              </li>)}
            </ul>}
          </section>
        </div>
      )}
    </section>
  );
}