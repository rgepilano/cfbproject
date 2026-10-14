"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useWatchlist } from "@/components/Watchlist";
import type { DepthChartPlayer } from "@/lib/depth-chart";
import { money } from "@/lib/util";

const OFFENSE = ["QB", "RB", "WR", "TE", "OL"];
const DEFENSE = ["DL", "LB", "DB"];
const SPECIAL_TEAMS = ["K", "P", "LS"];

function compareDefaultOrder(first: DepthChartPlayer, second: DepthChartPlayer) {
  const nilAmount = (player: DepthChartPlayer) => player.nilEstimate == null ? Number.NEGATIVE_INFINITY : player.nilEstimate;
  return first.posGroup.localeCompare(second.posGroup)
    || nilAmount(second) - nilAmount(first)
    || first.position.localeCompare(second.position)
    || first.name.localeCompare(second.name);
}

function restorePlayers(players: DepthChartPlayer[], portalPlayers: DepthChartPlayer[], savedKeys: string[], excludedKeys: string[]) {
  const defaultPlayers = [...players, ...portalPlayers].sort(compareDefaultOrder);
  const available = new Map(defaultPlayers.map((player) => [player.key, player]));
  const excluded = new Set(excludedKeys);
  const chosen: DepthChartPlayer[] = [];
  const seenKeys = new Set<string>();
  const seenIdentities = new Map<string, number>();
  const add = (player: DepthChartPlayer) => {
    const identity = player.athleteId
      ? `athlete:${player.athleteId}`
      : `name:${player.name.toLowerCase().replace(/\s+/g, " ").trim()}:${player.position}`;
    const existingIndex = seenIdentities.get(identity);
    if (existingIndex !== undefined) {
      const existing = chosen[existingIndex];
      existing.watchKeys = [...new Set([...existing.watchKeys, ...player.watchKeys])];
      if (existing.nilEstimate == null && player.nilEstimate != null) {
        existing.nilEstimate = player.nilEstimate;
        existing.nilBasis = player.nilBasis;
      }
      if (existing.returnProbability == null) existing.returnProbability = player.returnProbability;
      if (existing.team == null) existing.team = player.team;
      return;
    }
    chosen.push(player);
    seenIdentities.set(identity, chosen.length - 1);
    seenKeys.add(player.key);
  };
  for (const key of savedKeys) {
    const player = available.get(key);
    if (player && !excluded.has(key) && !seenKeys.has(key)) add(player);
  }
  for (const player of defaultPlayers) if (!excluded.has(player.key) && !seenKeys.has(player.key)) add(player);
  return chosen;
}

function groupPlayers(players: DepthChartPlayer[], groups: string[]) {
  return groups.map((group) => ({
    group,
    players: players.filter((player) => player.posGroup === group),
  })).filter((item) => item.players.length > 0);
}

export function DepthChartBoard({
  team, season, players: initialPlayers, portalPlayers, portalSeason, dataMode, teamNilPoolMillions, savedEntryKeys, excludedKeys: initialExcluded, customOrder: initialCustomOrder,
}: {
  team: string; season: string; players: DepthChartPlayer[]; portalPlayers: DepthChartPlayer[]; portalSeason: string | null;
  dataMode: "actual" | "projected"; teamNilPoolMillions: number | null; savedEntryKeys: string[]; excludedKeys: string[]; customOrder: boolean;
}) {
  const watchlist = useWatchlist();
  const watchedKeys = new Set(watchlist.items.map((item) => item.key));
  const baselinePlayers = initialPlayers.filter((player) => player.source !== "watchlist"
    || player.watchKeys.some((key) => watchedKeys.has(key)));
  const watchedPortalPlayers = portalPlayers.filter((player) => player.watchKeys.some((key) => watchedKeys.has(key)));
  const initialBoard = restorePlayers(initialPlayers, [], initialCustomOrder ? savedEntryKeys : [], initialExcluded);
  const [boardPlayers, setBoardPlayers] = useState<DepthChartPlayer[]>(initialBoard);
  const [excluded, setExcluded] = useState<string[]>(initialExcluded);
  const [customOrder, setCustomOrder] = useState(initialCustomOrder);
  const [draggedKey, setDraggedKey] = useState("");
  const [saveState, setSaveState] = useState("Loading watchlist...");
  const [boardReady, setBoardReady] = useState(false);
  const initialized = useRef(false);
  const priorWatchedKeys = useRef(new Set<string>());
  const excludedRef = useRef(excluded);
  const lastSaved = useRef("");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    excludedRef.current = excluded;
  }, [excluded]);

  useEffect(() => {
    if (!watchlist.ready) return;
    const currentWatchedKeys = new Set(watchlist.items.map((item) => item.key));
    const baseline = initialPlayers.filter((player) => player.source !== "watchlist"
      || player.watchKeys.some((key) => currentWatchedKeys.has(key)));
    const portal = portalPlayers.filter((player) => player.watchKeys.some((key) => currentWatchedKeys.has(key)));
    const available = new Map([...baseline, ...portal].map((player) => [player.key, player]));
    const savedExclusions = initialized.current ? excludedRef.current : initialExcluded;
    const validExcluded = savedExclusions.filter((key) => available.has(key));

    if (!initialized.current) {
      initialized.current = true;
      priorWatchedKeys.current = currentWatchedKeys;
      setExcluded(validExcluded);
      const restored = restorePlayers(baseline, portal, initialCustomOrder ? savedEntryKeys : [], validExcluded);
      lastSaved.current = JSON.stringify({ entryKeys: restored.map((player) => player.key), excludedKeys: validExcluded, customOrder: initialCustomOrder });
      setBoardPlayers(restored);
      setBoardReady(true);
      return;
    }

    const newlyWatched = new Set([...currentWatchedKeys].filter((key) => !priorWatchedKeys.current.has(key)));
    priorWatchedKeys.current = currentWatchedKeys;
    setExcluded(validExcluded);
    setBoardPlayers((current) => {
      const next = current.filter((player) => available.has(player.key));
      const present = new Set(next.map((player) => player.key));
      for (const player of [...baseline, ...portal]) {
        if (player.watchKeys.some((key) => newlyWatched.has(key)) && !present.has(player.key) && !validExcluded.includes(player.key)) {
          next.push(player);
          present.add(player.key);
        }
      }
      return customOrder ? next : next.sort(compareDefaultOrder);
    });
  }, [watchlist.ready, watchlist.items, initialPlayers, portalPlayers, initialExcluded, savedEntryKeys, initialCustomOrder, customOrder]);

  useEffect(() => {
    if (!boardReady) return;
    const snapshot = JSON.stringify({ entryKeys: boardPlayers.map((player) => player.key), excludedKeys: excluded, customOrder });
    if (snapshot === lastSaved.current) return;
    const timer = setTimeout(() => {
      setSaveState("Saving...");
      saveQueue.current = saveQueue.current.then(async () => {
        const response = await fetch("/api/what-if", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team, season, entryKeys: boardPlayers.map((player) => player.key), excludedKeys: excluded, customOrder }),
        });
        if (!response.ok) throw new Error("Could not save this board.");
        lastSaved.current = snapshot;
        setSaveState("Saved");
      }).catch(() => setSaveState("Save failed"));
    }, 350);
    return () => clearTimeout(timer);
  }, [boardPlayers, boardReady, customOrder, excluded, season, team]);

  const knownNilTotal = boardPlayers.reduce((sum, player) => sum + (player.nilEstimate == null ? 0 : player.nilEstimate), 0);
  const unknownNilCount = boardPlayers.filter((player) => player.nilEstimate == null).length;
  const offenseNilTotal = boardPlayers.reduce((sum, player) =>
    sum + (OFFENSE.includes(player.posGroup) && player.nilEstimate != null ? player.nilEstimate : 0), 0);
  const defenseNilTotal = boardPlayers.reduce((sum, player) =>
    sum + (DEFENSE.includes(player.posGroup) && player.nilEstimate != null ? player.nilEstimate : 0), 0);
  const offenseDefenseNilTotal = offenseNilTotal + defenseNilTotal;
  const removedPlayers = restorePlayers(baselinePlayers, watchedPortalPlayers, [], []).filter((player) => excluded.includes(player.key));

  function reorder(sourceKey: string, targetKey: string) {
    const sourceIndex = boardPlayers.findIndex((player) => player.key === sourceKey);
    const targetIndex = boardPlayers.findIndex((player) => player.key === targetKey);
    if (sourceIndex < 0 || targetIndex < 0 || boardPlayers[sourceIndex].posGroup !== boardPlayers[targetIndex].posGroup) return;
    const next = [...boardPlayers];
    [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
    setBoardPlayers(next);
    setCustomOrder(true);
  }

  function removePlayer(player: DepthChartPlayer) {
    setBoardPlayers((current) => current.filter((item) => item.key !== player.key));
    setExcluded((current) => [...new Set([...current, player.key])]);
  }

  function restorePlayer(player: DepthChartPlayer) {
    setExcluded((current) => current.filter((key) => key !== player.key));
    setBoardPlayers((current) => {
      if (current.some((item) => item.key === player.key)) return current;
      const next = [...current, player];
      return customOrder ? next : next.sort(compareDefaultOrder);
    });
  }

  function toggleWatchedPlayer(player: DepthChartPlayer) {
    const watchedItems = watchlist.items.filter((item) => player.watchKeys.includes(item.key));
    if (watchedItems.length === 0) return;
    watchlist.removeMany(watchedItems.map((item) => item.key));
    removePlayer(player);
  }

  function resetBoard() {
    setBoardPlayers(restorePlayers(baselinePlayers, watchedPortalPlayers, [], []));
    setExcluded([]);
    setCustomOrder(false);
  }

  function handleDrop(event: DragEvent<HTMLLIElement>, targetKey: string) {
    event.preventDefault();
    const sourceKey = event.dataTransfer.getData("text/plain");
    reorder(sourceKey, targetKey);
    setDraggedKey("");
  }

  function renderUnit(player: DepthChartPlayer, rank: number) {
    const watched = player.watchKeys.some((key) => watchedKeys.has(key));
    return (
      <li key={player.key} draggable onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", player.key);
        event.dataTransfer.effectAllowed = "move";
        setDraggedKey(player.key);
      }} onDragEnd={() => setDraggedKey("")}
        onDragOver={(event) => { if (draggedKey) event.preventDefault(); }} onDrop={(event) => handleDrop(event, player.key)}
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 px-2 py-2 last:border-0 dark:border-slate-800 ${draggedKey === player.key ? "opacity-40" : ""}`}>
        <span className="cursor-grab select-none text-slate-400" title="Drag to reorder within this position group" aria-hidden="true">⠿</span>
        <span className="w-5 text-xs tabular-nums text-slate-500">{rank}</span>
        <span className="w-10 text-xs font-semibold text-slate-500">{player.position}</span>
        <div className="min-w-36 flex-1">
          {player.athleteId ? <Link className="font-medium text-blue-700 hover:underline dark:text-blue-400" href={`/players/${player.athleteId}`}>{player.name}</Link>
            : <span className="font-medium">{player.name}</span>}
          <p className="text-xs text-slate-500">Current team: {player.team ?? "Unknown"}</p>
          <p className="text-xs text-slate-500">{player.source === "portal" ? "Portal addition"
            : player.source === "recruit" ? "Committed recruit"
              : player.source === "watchlist" ? "Watchlist addition"
                : player.returnProbability == null ? dataMode === "projected" ? "Return projection unavailable" : "Rostered"
                  : `Projected return · ${(player.returnProbability * 100).toFixed(0)}%`}</p>
        </div>
        <span title={player.nilBasis} className="text-xs text-slate-500">{money(player.nilEstimate)} · {season} NIL at {team}</span>
        <div className="flex gap-1">
          {watched && <button type="button" aria-label={`Remove ${player.name} from watchlist and what-if scenario`}
            title="Remove from watchlist and what-if scenario" onClick={() => toggleWatchedPlayer(player)}
            className="rounded px-2 py-1 text-base text-amber-500">★</button>}
          <button type="button" aria-label={`Remove ${player.name} from scenario`} title="Remove from scenario"
            onClick={() => removePlayer(player)} className="rounded border px-2 py-1 text-xs">×</button>
        </div>
      </li>
    );
  }

  function renderSide(title: string, groups: string[]) {
    const sections = groupPlayers(boardPlayers, groups);
    const nilTotal = title === "Offense" ? offenseNilTotal : title === "Defense" ? defenseNilTotal : null;
    const nilShare = nilTotal == null || offenseDefenseNilTotal === 0 ? null : nilTotal / offenseDefenseNilTotal;
    return (
      <section aria-label={`${title} depth chart`}>
        <h2 className="flex items-baseline justify-between gap-3 border-b-2 border-slate-800 pb-2 text-lg font-semibold dark:border-slate-200">
          <span>{title}</span>
          {nilTotal != null && <span title="Share of known offense and defense NIL estimates" className="text-sm font-normal text-slate-600 dark:text-slate-400">
            {money(nilTotal)} · {nilShare == null ? "—" : `${(nilShare * 100).toFixed(1)}%`}
          </span>}
        </h2>
        {sections.length === 0 ? <p className="py-4 text-sm text-slate-500">No players in this unit.</p> : sections.map(({ group, players: groupPlayers }) => {
          const groupNilTotal = groupPlayers.reduce((sum, player) => sum + (player.nilEstimate ?? 0), 0);
          const groupShare = knownNilTotal > 0 ? groupNilTotal / knownNilTotal : null;
          return (
            <div key={group} className="border-b border-slate-200 py-3 last:border-0 dark:border-slate-800">
              <h3 className="mb-2 flex items-baseline justify-between gap-3 text-sm font-semibold">
                <span>{group}</span>
                <span title="Share of known scenario NIL" className="font-normal text-slate-600 dark:text-slate-400">
                  {money(groupNilTotal)} · {groupShare == null ? "—" : `${(groupShare * 100).toFixed(1)}%`}
                </span>
              </h3>
              <ol>{groupPlayers.map((player, index) => renderUnit(player, index + 1))}</ol>
            </div>
          );
        })}
      </section>
    );
  }

  return (
    <div className="space-y-5" aria-busy={saveState === "Saving..."}>
      <section className="border-y border-slate-200 py-3 dark:border-slate-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-semibold">{team} · {season} {dataMode === "projected" ? "Projected Board" : "Roster Board"}</p>
            <p className="text-xs text-slate-500">{dataMode === "projected"
              ? "Built from the prior-season roster. Return likelihood and NIL values are projections, not confirmed roster status or commitments."
              : customOrder ? "Custom drag order. NIL estimates are for the selected year and school."
                : "Default order is highest-to-lowest NIL estimate within each position; missing estimates sort last."}</p>
            <p className="mt-1 text-xs text-slate-500">Portal pool: {portalSeason ? `uncommitted entrants from ${portalSeason}` : "no portal-entry data for this season"}. <Link className="underline" href={`/portal?team=${encodeURIComponent(team)}`}>Star portal players on the Portal board</Link> to add them here.</p>
          </div>
          <div className="flex items-center gap-3">
            <span role="status" className="text-xs text-slate-500">{saveState}</span>
            <button type="button" disabled={!watchlist.ready} onClick={resetBoard}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700">Reset board</button>
          </div>
        </div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-slate-500">Scenario NIL total</dt><dd className="text-xl font-semibold">{money(knownNilTotal)}</dd><dd className="text-xs text-slate-500">{boardPlayers.length - unknownNilCount}/{boardPlayers.length} players with estimates</dd></div>
          <div><dt className="text-xs text-slate-500">Estimated team NIL pool · 2026 reference</dt><dd className="text-xl font-semibold">{teamNilPoolMillions == null ? "—" : `$${teamNilPoolMillions.toFixed(2)}M`}</dd><dd className="text-xs text-slate-500">Planning estimate, not verified available funds</dd></div>
        </dl>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        {renderSide("Offense", OFFENSE)}
        {renderSide("Defense", DEFENSE)}
      </div>
      {renderSide("Special Teams", SPECIAL_TEAMS)}
      {groupPlayers(boardPlayers, ["ATH", "UNK"]).length > 0 && renderSide("Other", ["ATH", "UNK"])}

      {watchlist.ready && watchlist.items.length === 0
        && <p className="text-sm text-slate-500">Your full roster and committed recruits are shown. Star additional players to include them in this scenario.</p>}

      {removedPlayers.length > 0 && <section className="border-t border-slate-200 pt-4 dark:border-slate-800">
        <h2 className="text-lg font-semibold">Removed from scenario</h2>
        <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-800">
          {removedPlayers.map((player) => <li key={player.key} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>{player.name} · {player.position}</span>
            <button type="button" onClick={() => restorePlayer(player)} className="rounded border px-3 py-1 text-sm">Restore</button>
          </li>)}
        </ul>
      </section>}

    </div>
  );
}