import "server-only";
import { sql, tableExists } from "@/lib/db";
import { type Candidate, DEFAULT_WEIGHTS, scoreCandidate } from "@/lib/portal-score";

const POS_GROUP: Record<string, string> = {
  QB: "QB", PRO: "QB", DUAL: "QB", RB: "RB", FB: "RB", APB: "RB", WR: "WR", TE: "TE",
  OL: "OL", OT: "OL", OG: "OL", G: "OL", C: "OL", OC: "OL", IOL: "OL",
  DL: "DL", DT: "DL", NT: "DL", DE: "DL", EDGE: "DL", SDE: "DL", WDE: "DL",
  LB: "LB", ILB: "LB", OLB: "LB", DB: "DB", CB: "DB", S: "DB", SAF: "DB",
  PK: "K", K: "K", P: "P", LS: "LS", ATH: "ATH",
};
const IMPORTANCE: Record<string, number> = {
  QB: 1, RB: 0.8, WR: 0.85, TE: 0.75, OL: 0.85, DL: 0.9, LB: 0.8, DB: 0.85, K: 0.4, P: 0.3, LS: 0.2, ATH: 0.7,
};
const MAX_CANDIDATES = 1500;

// Reference data changes only when the pipeline reruns; cache it briefly to avoid repeat round trips.
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

export function getPortalYears(): Promise<string[]> {
  return cached("years", async () =>
    (await sql<{ season: number }>("SELECT DISTINCT season FROM analytics.portal_entry ORDER BY season DESC")).map((r) =>
      String(r.season),
    ),
  );
}

const getConferences = () =>
  cached("confs", () => sql<{ school: string; conference: string }>("SELECT school, conference FROM ing.teams WHERE classification = 'fbs'"));
const getHasLocation = () => cached("hasLocation", () => tableExists("cfbd_team_location"));

type Raw = {
  athlete_id: string | null; first_name: string | null; last_name: string | null; position: string | null;
  pos_group?: string | null; current_team: string | null; class_year: number | null;
  production_pct: number | null; usage_share: number | null; usage_pct?: number | null; rating_pct?: number | null;
  portal_rating: number | null; portal_stars: number | null; transfer_risk: number | null; nil_value: number | null;
  seasons_left_est: number | null; home_state: string | null;
  destination?: string | null; source?: string; quality?: number; eligibility_score?: number;
};

export async function getPortalBoard(
  team: string,
  year?: string,
  latestYear?: string,
): Promise<{ candidates: Candidate[]; hasLocation: boolean }> {
  if (!year || !latestYear) {
    latestYear = (await getPortalYears())[0];
    year = latestYear;
  }
  const hasLocation = await getHasLocation();
  const [entrants, watch, needs, confs, loc] = await Promise.all([
    sql<Raw>(
      `SELECT pe.athlete_id::text AS athlete_id, pe.first_name, pe.last_name, pe.position, pe.origin AS current_team,
              pe.destination, pe.rating AS portal_rating, pe.stars AS portal_stars,
              ps.class_year, ps.production_pct, ps.usage_share, ps.usage_pct, ps.rating_pct, ps.seasons_left_est, ps.home_state,
              dr.transfer_risk, n.nil_value
       FROM analytics.portal_entry pe
       LEFT JOIN analytics.player_season ps ON ps.athlete_id = pe.athlete_id AND ps.season = pe.season - 1
       LEFT JOIN analytics.departure_risk dr ON dr.athlete_id = pe.athlete_id
       LEFT JOIN analytics.player_nil n ON n.athlete_id = pe.athlete_id AND n.season = pe.season - 1
       WHERE pe.season = $1 AND coalesce(pe.eligibility, '') <> 'Withdrawn'`,
      [Number(year)],
    ),
    year === latestYear
      ? sql<Raw>(
          `SELECT athlete_id::text AS athlete_id, first_name, last_name, position, pos_group, current_team, class_year,
                  production_pct, usage_share, portal_rating, portal_stars, transfer_risk, seasons_left_est, home_state,
                  quality, eligibility_score, nil_value, source
           FROM analytics.portal_candidate WHERE source LIKE 'Watch%'`,
        )
      : Promise.resolve([] as Raw[]),
    sql<{ pos_group: string; need_score: number }>(
      "SELECT pos_group, need_score FROM analytics.roster_pipeline WHERE team = $1 AND horizon = 1",
      [team],
    ),
    getConferences(),
    hasLocation
      ? sql<{ state: string }>("SELECT state FROM analytics.cfbd_team_location WHERE team = $1 LIMIT 1", [team])
      : Promise.resolve([] as { state: string }[]),
  ]);

  // Entrants lack a precomputed quality score; mirror the pipeline's formula using portal-rating rank within the year.
  const ratings = entrants.map((r) => Number(r.portal_rating)).filter((v) => v > 0).sort((a, b) => a - b);
  const pctOf = (v: number) => {
    let lo = 0, hi = ratings.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ratings[m] < v) lo = m + 1; else hi = m; }
    return ratings.length ? lo / ratings.length : 0.5;
  };

  const rows: Raw[] = entrants.map((r) => {
    const group = POS_GROUP[r.position ?? ""] ?? null;
    const pedigree = r.portal_rating != null ? pctOf(Number(r.portal_rating)) : r.rating_pct != null ? Number(r.rating_pct) : 0.5;
    const prod = r.production_pct != null ? Number(r.production_pct) : pedigree;
    const usagePct = r.usage_pct != null ? Number(r.usage_pct) : 0.5;
    const quality = Math.min(1, Math.max(0, (0.45 * prod + 0.2 * usagePct + 0.2 * pedigree + 0.15 * 0.5) * (IMPORTANCE[group ?? ""] ?? 0.7)));
    const left = r.seasons_left_est != null ? Number(r.seasons_left_est) - 1 : 1;
    return {
      ...r,
      pos_group: group,
      source: r.destination ? `Committed to ${r.destination}` : "In portal (uncommitted)",
      quality: Math.round(quality * 1000) / 1000,
      eligibility_score: Math.min(1, Math.max(0, left / 4)),
    };
  });

  const needBy = new Map(needs.map((n) => [n.pos_group, Number(n.need_score) / 100]));
  const confBy = new Map(confs.map((c) => [c.school, c.conference]));
  const teamConf = confBy.get(team);
  const teamState = loc[0]?.state;

  const candidates = [...rows, ...watch]
    .filter((r) => r.current_team !== team)
    .map((r, i) => {
      const sameConf = teamConf !== undefined && confBy.get(r.current_team ?? "") === teamConf ? 1 : 0;
      const inState = teamState && r.home_state === teamState ? 1 : 0;
      const fit = hasLocation ? 0.6 * inState + 0.4 * sameConf : sameConf;
      const c = {
        ...r, candidate_id: i, source: r.source ?? "", quality: Number(r.quality), eligibility_score: Number(r.eligibility_score),
        need: needBy.get(r.pos_group ?? "") ?? 0, fit,
      } as Candidate;
      c.default_score = scoreCandidate(c, DEFAULT_WEIGHTS);
      return c;
    })
    .sort((a, b) => b.default_score - a.default_score)
    .slice(0, MAX_CANDIDATES);
  return { candidates, hasLocation };
}
