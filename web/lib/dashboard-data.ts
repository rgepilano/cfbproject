import "server-only";
import { getTeamNIL, sql } from "@/lib/db";
import { getPortalBoard } from "@/lib/portal";

export type Need = { pos_group: string; season: number; need_score: number; player_gap: number; projected_players: number; target_players: number };
export type DashboardRow = Record<string, string | number | null>;
type PortalCandidate = Awaited<ReturnType<typeof getPortalBoard>>["candidates"][number];

export type DashboardData = {
  needs: Need[];
  retain: DashboardRow[];
  commits: DashboardRow[];
  portalCandidates: PortalCandidate[];
  nilVal: number | null;
};

export async function getDashboardData(team: string): Promise<DashboardData> {
  const [needs, retain, commits, portal, nilVal] = await Promise.all([
    sql<Need>(
      `SELECT pos_group, season, need_score, player_gap, projected_players, target_players
       FROM analytics.roster_pipeline WHERE team = $1 AND horizon = 1 ORDER BY need_score DESC`,
      [team],
    ),
    sql<DashboardRow>(
      `SELECT athlete_id, first_name, last_name, pos_group, class_year, transfer_risk, transfer_tier, nfl_risk,
              retention_priority, transfer_drivers, nil_value, nil_forecast, nil_forecast_drivers, forecast_season
       FROM analytics.departure_risk WHERE team = $1 AND graduating = 0
       ORDER BY retention_priority DESC NULLS LAST LIMIT 8`,
      [team],
    ),
    sql<DashboardRow>(
      `SELECT recruit_id, name, position, stars, success_score, tier, estimated_nil
       FROM analytics.recruit_projection WHERE committed_to = $1 ORDER BY success_score DESC LIMIT 8`,
      [team],
    ),
    getPortalBoard(team),
    getTeamNIL(team),
  ]);

  return { needs, retain, commits, portalCandidates: portal.candidates.slice(0, 8), nilVal };
}