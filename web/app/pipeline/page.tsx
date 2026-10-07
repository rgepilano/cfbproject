import Link from "next/link";
import { ParamSelect } from "@/components/ParamSelect";
import { Bar, Card, Table, Td, Th } from "@/components/ui";
import { getTeams, sql } from "@/lib/db";
import { DEFAULT_TEAM, num, param, pick, qs, type SearchParams } from "@/lib/util";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionUsername } from "@/lib/session";
import { getUserDefaultTeam } from "@/lib/users";

type Row = {
  pos_group: string; season: number; current_players: number; expected_returning: number;
  departures_eligibility: number; at_risk_players: number; incoming_recruits: number; projected_players: number;
  target_players: number; projected_value: number; target_value: number; player_gap: number; need_score: number;
};

export default async function PipelinePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const teams = await getTeams();
  const requested = param(sp, "team");
  const c = (await cookies()).get(SESSION_COOKIE)?.value;
  const username = await getSessionUsername(c);
  const userTeam = username ? getUserDefaultTeam(username) : null;
  const team = requested && teams.includes(requested)
    ? requested
    : userTeam
    ? teams.find((t) => t.toLowerCase() === userTeam.toLowerCase()) ?? DEFAULT_TEAM
    : DEFAULT_TEAM;
  const horizon = pick(param(sp, "h"), ["1", "2", "3"] as const, "1");

  const rows = await sql<Row>(
    `SELECT * FROM analytics.roster_pipeline WHERE team = $1 AND horizon = $2 ORDER BY need_score DESC, pos_group`,
    [team, Number(horizon)],
  );
  const season = rows[0]?.season;

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Roster Pipeline — {team}</h1>
          <p className="text-sm text-slate-500">
            Expected roster by position for {season ?? "—"}: returning players weighted by (1 − departure probability),
            plus committed recruits. Targets are the FBS median headcount and 75th-percentile room value.
          </p>
        </div>
        <ParamSelect name="team" value={team} options={teams} label="Team" />
      </div>

      <div className="flex gap-2">
        {["1", "2", "3"].map((h) => (
          <Link key={h} href={qs({ team }, { h })}
            className={`rounded px-3 py-1 text-sm ${h === horizon ? "bg-blue-600 text-white" : "border border-slate-300 dark:border-slate-700"}`}>
            {season ? Number(season) - Number(horizon) + Number(h) : `+${h}`}
          </Link>
        ))}
        <a className="ml-auto text-sm text-blue-600" href={`/api/export?table=roster_pipeline&team=${encodeURIComponent(team)}`}>CSV</a>
      </div>

      <Card title="By position group">
        <Table>
          <thead>
            <tr>
              <Th>Group</Th><Th>Now</Th><Th>Out of elig.</Th><Th>At risk</Th><Th>Returning</Th><Th>Incoming</Th>
              <Th>Projected</Th><Th>Target</Th><Th>Gap</Th><Th>Value vs target</Th><Th>Need</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pos_group}>
                <Td className="font-medium">{r.pos_group}</Td>
                <Td>{num(r.current_players, 0)}</Td>
                <Td>{num(r.departures_eligibility, 0)}</Td>
                <Td>{num(r.at_risk_players)}</Td>
                <Td>{num(r.expected_returning)}</Td>
                <Td>{num(r.incoming_recruits)}</Td>
                <Td className="font-semibold">{num(r.projected_players)}</Td>
                <Td>{num(r.target_players, 0)}</Td>
                <Td className={Number(r.player_gap) > 0 ? "text-red-600" : "text-green-600"}>{num(r.player_gap)}</Td>
                <Td className="w-48">
                  <Bar value={Number(r.projected_value)} max={Number(r.target_value)}
                    color={Number(r.projected_value) >= Number(r.target_value) ? "bg-green-500" : "bg-amber-500"} />
                </Td>
                <Td className="font-semibold">{num(r.need_score, 0)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
