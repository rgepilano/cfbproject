import "server-only";
import { sql, tableExists } from "@/lib/db";
import { type Candidate, DEFAULT_WEIGHTS, scoreCandidate } from "@/lib/portal-score";

export async function getPortalBoard(team: string): Promise<{ candidates: Candidate[]; hasLocation: boolean }> {
  const hasLocation = await tableExists("cfbd_team_location");
  const [rows, needs, confs, loc] = await Promise.all([
    sql<Omit<Candidate, "need" | "fit" | "default_score">>(
      `SELECT candidate_id, source, athlete_id, first_name, last_name, position, pos_group, current_team, class_year,
              production_pct, usage_share, portal_rating, portal_stars, transfer_risk, seasons_left_est, home_state,
              quality, eligibility_score
       FROM analytics.portal_candidate WHERE current_team IS DISTINCT FROM $1`,
      [team],
    ),
    sql<{ pos_group: string; need_score: number }>(
      "SELECT pos_group, need_score FROM analytics.roster_pipeline WHERE team = $1 AND horizon = 1",
      [team],
    ),
    sql<{ school: string; conference: string }>("SELECT school, conference FROM ing.teams WHERE classification = 'fbs'"),
    hasLocation
      ? sql<{ state: string }>("SELECT state FROM analytics.cfbd_team_location WHERE team = $1 LIMIT 1", [team])
      : Promise.resolve([] as { state: string }[]),
  ]);

  const needBy = new Map(needs.map((n) => [n.pos_group, Number(n.need_score) / 100]));
  const confBy = new Map(confs.map((c) => [c.school, c.conference]));
  const teamConf = confBy.get(team);
  const teamState = loc[0]?.state;

  const candidates = rows.map((r) => {
    const sameConf = teamConf !== undefined && confBy.get(r.current_team ?? "") === teamConf ? 1 : 0;
    const inState = teamState && r.home_state === teamState ? 1 : 0;
    const fit = hasLocation ? 0.6 * inState + 0.4 * sameConf : sameConf;
    const c = { ...r, quality: Number(r.quality), eligibility_score: Number(r.eligibility_score),
                need: needBy.get(r.pos_group ?? "") ?? 0, fit };
    return { ...c, default_score: scoreCandidate(c, DEFAULT_WEIGHTS) };
  });
  candidates.sort((a, b) => b.default_score - a.default_score);
  return { candidates, hasLocation };
}
