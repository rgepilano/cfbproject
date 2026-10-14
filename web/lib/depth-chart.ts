import "server-only";
import { getTeamNIL, sql } from "@/lib/db";
import { getPortalBoard, getPortalYears } from "@/lib/portal";

const GROUP_BY_POSITION: Record<string, string> = {
  QB: "QB", PRO: "QB", DUAL: "QB", RB: "RB", FB: "RB", APB: "RB", WR: "WR", TE: "TE",
  OL: "OL", T: "OL", OT: "OL", LT: "OL", RT: "OL", OG: "OL", G: "OL", C: "OL", OC: "OL", IOL: "OL",
  DL: "DL", IDL: "DL", DLT: "DL", DT: "DL", NT: "DL", DE: "DL", EDGE: "DL", SDE: "DL", WDE: "DL",
  LB: "LB", ILB: "LB", OLB: "LB", DB: "DB", CB: "DB", S: "DB", SAF: "DB",
  K: "K", PK: "K", P: "P", LS: "LS", ATH: "ATH",
};

function inferPositionGroup(position: string, posGroup?: string | null) {
  const normalizedGroup = posGroup?.trim().toUpperCase() ?? "";
  const normalizedPosition = position.trim().toUpperCase();
  return GROUP_BY_POSITION[normalizedGroup] ?? GROUP_BY_POSITION[normalizedPosition] ?? (normalizedGroup || normalizedPosition || "UNK");
}

export type DepthChartPlayer = {
  key: string;
  athleteId: string | null;
  name: string;
  team: string | null;
  position: string;
  posGroup: string;
  source: "roster" | "recruit" | "watchlist" | "portal";
  watchKeys: string[];
  nilEstimate: number | null;
  nilBasis: string;
  returnProbability: number | null;
};

type RawPlayer = {
  athlete_id: string | number;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  pos_group: string | null;
  nil_estimate: number | null;
  nil_basis: string;
  return_probability?: number | null;
};

type RawRecruit = {
  recruit_id: string | number;
  athlete_id: string | null;
  name: string | null;
  position: string | null;
  pos_group: string | null;
  committed_to: string | null;
  estimated_nil: number | null;
  class_year: number;
};

type WatchItemRow = { item_key: string; kind: string; item_id: string; label: string; sub: string | null };
type WatchPlayerRow = {
  athlete_id: string; first_name: string | null; last_name: string | null; position: string | null;
  pos_group: string | null; team: string | null; season: number;
};

export type DepthChartData = {
  players: DepthChartPlayer[];
  portalPlayers: DepthChartPlayer[];
  portalSeason: string | null;
  dataMode: "actual" | "projected";
  teamNilPoolMillions: number | null;
  savedEntryKeys: string[];
  excludedKeys: string[];
  customOrder: boolean;
};

export async function getDepthChartYears(): Promise<string[]> {
  const rows = await sql<{ year: number }>(
    `SELECT year FROM (
       SELECT season AS year FROM analytics.player_season
       UNION SELECT forecast_season AS year FROM analytics.player_nil_forecast
     ) seasons ORDER BY year DESC`,
  );
  return rows.map((row) => String(row.year));
}

export async function getDepthChartData(team: string, year: string, username: string | null): Promise<DepthChartData> {
  const season = Number(year);
  const [rosterRows, recruitRows, portalYears, saved, teamNilPoolMillions, watchItems] = await Promise.all([
    sql<RawPlayer>(
      `SELECT ps.athlete_id::text AS athlete_id, ps.first_name, ps.last_name, ps.position, ps.pos_group,
              pn.nil_value AS nil_estimate, 'season estimate' AS nil_basis, NULL::double precision AS return_probability
       FROM analytics.player_season ps
       LEFT JOIN analytics.player_nil pn ON pn.athlete_id = ps.athlete_id AND pn.season = ps.season
       WHERE ps.team = $1 AND ps.season = $2
       ORDER BY ps.pos_group, ps.position, ps.depth_rank NULLS LAST, ps.last_name`,
      [team, season],
    ),
    sql<RawRecruit>(
      `SELECT recruit_id::text, athlete_id::bigint::text AS athlete_id, name, position, pos_group, committed_to, estimated_nil, class_year
       FROM analytics.recruit_projection
       WHERE committed_to = $1 AND class_year = $2
       ORDER BY success_score DESC NULLS LAST, recruit_id`,
      [team, season],
    ),
    getPortalYears(),
    username ? sql<{ entry_keys: string[]; excluded_keys: string[]; custom_order: boolean }>(
      `SELECT entry_keys, excluded_keys, custom_order FROM web.what_if_depth_chart
       WHERE username = $1 AND team = $2 AND season = $3`, [username, team, season],
    ) : Promise.resolve([] as { entry_keys: string[]; excluded_keys: string[]; custom_order: boolean }[]),
    getTeamNIL(team, 2026),
    username ? sql<WatchItemRow>(
      `SELECT item_key, kind, item_id, label, sub FROM web.watchlist
       WHERE username = $1 AND kind IN ('player', 'recruit') ORDER BY added_at`, [username],
    ) : Promise.resolve([] as WatchItemRow[]),
  ]);

  const watchedPlayerIds = watchItems.filter((item) => item.kind === "player" && /^\d+$/.test(item.item_id)).map((item) => item.item_id);
  const watchedRecruitIds = watchItems.filter((item) => item.kind === "recruit" && /^\d+$/.test(item.item_id)).map((item) => item.item_id);
  const [watchedPlayerRows, watchedRecruitRows] = await Promise.all([
    watchedPlayerIds.length ? sql<WatchPlayerRow>(
      `SELECT DISTINCT ON (ps.athlete_id) ps.athlete_id::text AS athlete_id, ps.first_name, ps.last_name,
              ps.position, ps.pos_group, ps.team, ps.season
       FROM analytics.player_season ps WHERE ps.athlete_id = ANY($1::bigint[])
       ORDER BY ps.athlete_id, ps.season DESC`, [watchedPlayerIds],
    ) : Promise.resolve([] as WatchPlayerRow[]),
    watchedRecruitIds.length ? sql<RawRecruit>(
      `SELECT recruit_id::text, athlete_id::bigint::text AS athlete_id, name, position, pos_group,
              committed_to, estimated_nil, class_year
       FROM analytics.recruit_projection WHERE recruit_id = ANY($1::bigint[])`, [watchedRecruitIds],
    ) : Promise.resolve([] as RawRecruit[]),
  ]);

  const dataMode = rosterRows.length > 0 ? "actual" : "projected";
  const projectedRows = rosterRows.length > 0 ? [] : await sql<RawPlayer>(
    `SELECT ps.athlete_id::text AS athlete_id, ps.first_name, ps.last_name, ps.position, ps.pos_group,
            f.nil_forecast AS nil_estimate,
            CASE WHEN f.nil_forecast IS NOT NULL THEN 'selected-school next-season forecast' ELSE 'selected-year estimate unavailable' END AS nil_basis,
            f.return_probability
     FROM analytics.player_season ps
     LEFT JOIN analytics.player_nil_forecast f
       ON f.athlete_id = ps.athlete_id AND f.forecast_season = $2
     WHERE ps.team = $1 AND ps.season = $2 - 1 AND COALESCE(ps.out_of_eligibility, 0) = 0
     ORDER BY f.return_probability DESC NULLS LAST, ps.pos_group, ps.depth_rank NULLS LAST, ps.last_name`,
    [team, season],
  );
  const baseRows = rosterRows.length > 0 ? rosterRows : projectedRows;
  const rosterPlayers: DepthChartPlayer[] = baseRows.map((row) => ({
    key: `roster-${row.athlete_id}`,
    athleteId: String(row.athlete_id),
    name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Unknown player",
    team,
    position: (row.position ?? row.pos_group ?? "UNK").toUpperCase(),
    posGroup: inferPositionGroup(row.position ?? "", row.pos_group),
    source: "roster",
    watchKeys: [`player:${row.athlete_id}`],
    nilEstimate: row.nil_estimate == null ? null : Number(row.nil_estimate),
    nilBasis: dataMode === "projected" ? `${row.nil_basis} · ${team} · ${season}` : `${season} roster estimate · ${team}`,
    returnProbability: row.return_probability == null ? null : Number(row.return_probability),
  }));
  const recruits: DepthChartPlayer[] = recruitRows.map((row) => {
    const athleteId = row.athlete_id == null ? null : String(row.athlete_id);
    const watchKeys = [`recruit:${row.recruit_id}`];
    if (athleteId) watchKeys.push(`player:${athleteId}`);
    return {
      key: `recruit-${row.recruit_id}`,
      athleteId,
      name: row.name ?? "Unknown recruit",
      team: row.committed_to,
      position: (row.position ?? row.pos_group ?? "UNK").toUpperCase(),
      posGroup: inferPositionGroup(row.position ?? "", row.pos_group),
      source: "recruit",
      watchKeys,
      nilEstimate: row.estimated_nil == null ? null : Number(row.estimated_nil),
      nilBasis: `${season} recruit planning estimate`,
      returnProbability: null,
    };
  });
  const watchedPlayerById = new Map(watchedPlayerRows.map((row) => [row.athlete_id, row]));
  const watchlistPlayers: DepthChartPlayer[] = [];
  for (const item of watchItems.filter((entry) => entry.kind === "player")) {
    const row = watchedPlayerById.get(item.item_id);
    if (row) {
      watchlistPlayers.push({
        key: `roster-${row.athlete_id}`,
        athleteId: row.athlete_id,
        name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || item.label,
        team: row.team,
        position: (row.position ?? row.pos_group ?? "UNK").toUpperCase(),
        posGroup: inferPositionGroup(row.position ?? "", row.pos_group),
        source: "watchlist",
        watchKeys: [item.item_key],
        nilEstimate: null,
        nilBasis: `no ${season} selected-team estimate`,
        returnProbability: null,
      });
    }
  }
  const watchedRecruitById = new Map(watchedRecruitRows.map((row) => [String(row.recruit_id), row]));
  for (const item of watchItems.filter((entry) => entry.kind === "recruit")) {
    const row = watchedRecruitById.get(item.item_id);
    if (row) {
      const athleteId = row.athlete_id == null ? null : String(row.athlete_id);
      const matchingCommit = row.committed_to?.toLowerCase() === team.toLowerCase() && Number(row.class_year) === season;
      const watchKeys = [item.item_key];
      if (athleteId) watchKeys.push(`player:${athleteId}`);
      watchlistPlayers.push({
        key: `recruit-${row.recruit_id}`,
        athleteId,
        name: row.name ?? item.label,
        team: row.committed_to,
        position: (row.position ?? row.pos_group ?? "UNK").toUpperCase(),
        posGroup: inferPositionGroup(row.position ?? "", row.pos_group),
        source: "recruit",
        watchKeys,
        nilEstimate: matchingCommit && row.estimated_nil != null ? Number(row.estimated_nil) : null,
        nilBasis: matchingCommit ? `${season} recruit planning estimate` : `no ${season} selected-team estimate`,
        returnProbability: null,
      });
      continue;
    }
    const [positionHint, teamHint] = (item.sub ?? "").split(" · ");
    const position = (positionHint || "UNK").toUpperCase();
    watchlistPlayers.push({
      key: `recruit-${item.item_id}`, athleteId: null, name: item.label, team: teamHint || null,
      position, posGroup: inferPositionGroup(position), source: "watchlist", watchKeys: [item.item_key],
      nilEstimate: null, nilBasis: `no ${season} estimate`, returnProbability: null,
    });
  }
  for (const item of watchItems.filter((entry) => entry.kind === "player" && !watchedPlayerById.has(entry.item_id))) {
    const [positionHint, teamHint] = (item.sub ?? "").split(" · ");
    const position = (positionHint || "UNK").toUpperCase();
    watchlistPlayers.push({
      key: `roster-${item.item_id}`, athleteId: item.item_id, name: item.label, team: teamHint || null,
      position, posGroup: inferPositionGroup(position), source: "watchlist", watchKeys: [item.item_key],
      nilEstimate: null, nilBasis: `no ${season} selected-team estimate`, returnProbability: null,
    });
  }
  const playerByIdentity = new Map<string, DepthChartPlayer>();
  for (const player of [...rosterPlayers, ...recruits, ...watchlistPlayers]) {
    const identity = player.athleteId
      ? `athlete:${player.athleteId}`
      : `name:${player.name.toLowerCase().replace(/\s+/g, " ").trim()}:${player.position}`;
    const existing = playerByIdentity.get(identity);
    if (existing) {
      existing.watchKeys = [...new Set([...existing.watchKeys, ...player.watchKeys])];
    } else {
      playerByIdentity.set(identity, player);
    }
  }
  const players = [...playerByIdentity.values()];

  const latestPortalYear = portalYears[0] ?? null;
  const portalSeason = portalYears.includes(year) ? year
    : latestPortalYear && season > Number(latestPortalYear) ? latestPortalYear : null;
  const selectedSchoolIds = new Set([...rosterPlayers, ...recruits].flatMap((player) => player.athleteId ? [player.athleteId] : []));
  const supplementalIds = watchedPlayerIds.filter((id) => !selectedSchoolIds.has(id));
  const [portalBoard, supplementalBoard] = await Promise.all([
    portalSeason ? getPortalBoard(team, portalSeason, latestPortalYear ?? portalSeason) : Promise.resolve(null),
    supplementalIds.length ? getPortalBoard(team, undefined, undefined, undefined, supplementalIds) : Promise.resolve(null),
  ]);
  const candidates = [...(portalBoard?.candidates ?? []), ...(supplementalBoard?.candidates ?? [])];
  const portalPlayers = candidates
    .filter((candidate) => (candidate.source === "In portal (uncommitted)" || candidate.source.startsWith("Watch list") || candidate.source === "Player lookup")
      && candidate.current_team?.toLowerCase() !== team.toLowerCase())
    .map((candidate) => {
      const signingEstimate = candidate.signing_season === season ? candidate.signing_nil_estimate : null;
      return {
        key: `portal-${candidate.athlete_id ?? candidate.candidate_id}`,
        athleteId: candidate.athlete_id,
        name: `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim() || "Unmatched portal player",
        team: candidate.current_team,
        position: (candidate.position ?? candidate.pos_group ?? "UNK").toUpperCase(),
        posGroup: inferPositionGroup(candidate.position ?? "", candidate.pos_group),
        source: candidate.source === "In portal (uncommitted)" ? "portal" as const : "watchlist" as const,
        watchKeys: candidate.athlete_id ? [`player:${candidate.athlete_id}`] : [],
        nilEstimate: signingEstimate == null ? null : Number(signingEstimate),
        nilBasis: signingEstimate != null ? `${season} hypothetical signing estimate at ${team}` : `No ${season} NIL estimate at ${team}`,
        returnProbability: null,
      };
    });

  const savedEntryKeys = Array.isArray(saved[0]?.entry_keys) ? saved[0].entry_keys : [];
  const excludedKeys = Array.isArray(saved[0]?.excluded_keys) ? saved[0].excluded_keys : [];
  const customOrder = saved[0]?.custom_order ?? false;
  return { players, portalPlayers, portalSeason, dataMode, teamNilPoolMillions, savedEntryKeys, excludedKeys, customOrder };
}