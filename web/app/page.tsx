import Link from "next/link";
import { ParamSelect } from "@/components/ParamSelect";
import { Badge, Bar, Card, Empty, PlayerLink, Table, Td, Th } from "@/components/ui";
import { getTeams, sql, getTeamNIL } from "@/lib/db";
import { getPortalBoard } from "@/lib/portal";
import { DEFAULT_TEAM, money, name, num, param, pct, type SearchParams } from "@/lib/util";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionUsername } from "@/lib/session";
import { getUserDefaultTeam } from "@/lib/users";

type Need = { pos_group: string; need_score: number; player_gap: number; projected_players: number; target_players: number };
type Row = Record<string, string | number | null>;

export default async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
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
  const q = `?team=${encodeURIComponent(team)}`;

  const [needs, retain, commits, portal] = await Promise.all([
    sql<Need>(
      `SELECT pos_group, need_score, player_gap, projected_players, target_players
       FROM analytics.roster_pipeline WHERE team = $1 AND horizon = 1 ORDER BY need_score DESC`,
      [team],
    ),
    sql<Row>(
      `SELECT athlete_id, first_name, last_name, pos_group, class_year, transfer_risk, transfer_tier, nfl_risk,
              retention_priority, transfer_drivers, nil_value
       FROM analytics.departure_risk WHERE team = $1 AND graduating = 0
       ORDER BY retention_priority DESC NULLS LAST LIMIT 8`,
      [team],
    ),
    sql<Row>(
      `SELECT recruit_id, name, position, stars, success_score, tier, estimated_nil
       FROM analytics.recruit_projection WHERE committed_to = $1 ORDER BY success_score DESC LIMIT 8`,
      [team],
    ),
    getPortalBoard(team),
  ]);
  const nilVal = await getTeamNIL(team);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{team} — Roster Outlook</h1>
          <div className="text-sm text-slate-600">Estimated NIL (2026): {nilVal ? `$${nilVal.toFixed(2)}M` : "—"}</div>
        </div>
        <ParamSelect name="team" value={team} options={teams} label="Team" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Positional need next season" action={<Link className="text-sm text-blue-600" href={`/pipeline${q}`}>Pipeline →</Link>}>
          {needs.length === 0 ? (
            <Empty>No pipeline data.</Empty>
          ) : (
            <div className="space-y-2">
              {needs.map((n) => (
                <div key={n.pos_group} className="grid grid-cols-[3rem_1fr_11rem] items-center gap-3 text-sm">
                  <span className="font-medium">{n.pos_group}</span>
                  <Bar value={Number(n.need_score)} color={Number(n.need_score) >= 25 ? "bg-red-500" : "bg-blue-500"} />
                  <span className="text-slate-500">
                    need {num(n.need_score, 0)} · {num(n.projected_players)}/{num(n.target_players, 0)} players
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Top retention priorities" action={<Link className="text-sm text-blue-600" href={`/retention${q}`}>Retention →</Link>}>
          <Table>
            <thead><tr><Th>Player</Th><Th>Pos</Th><Th>Transfer</Th><Th>NFL</Th><Th>Est. NIL</Th><Th>Priority</Th></tr></thead>
            <tbody>
              {retain.map((r) => (
                <tr key={String(r.athlete_id)} title={String(r.transfer_drivers ?? "")}>
                  <Td><PlayerLink id={r.athlete_id}>{name(r)}</PlayerLink></Td>
                  <Td>{r.pos_group}</Td>
                  <Td><Badge>{r.transfer_tier}</Badge> {num(r.transfer_risk, 0)}</Td>
                  <Td>{num(r.nfl_risk, 0)}</Td>
                  <Td>{money(r.nil_value)}</Td>
                  <Td className="font-semibold">{num(r.retention_priority)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title="2027 commits" action={<Link className="text-sm text-blue-600" href={`/recruits?committed=${encodeURIComponent(team)}`}>Recruit board →</Link>}>
          {commits.length === 0 ? (
            <Empty>No 2027 commits recorded for {team}.</Empty>
          ) : (
            <Table>
              <thead><tr><Th>Recruit</Th><Th>Pos</Th><Th>Stars</Th><Th>Success</Th><Th>Tier</Th><Th>Est. NIL</Th></tr></thead>
              <tbody>
                {commits.map((r) => (
                  <tr key={String(r.recruit_id)}>
                    <Td>{r.name}</Td><Td>{r.position}</Td><Td>{num(r.stars, 0)}</Td>
                    <Td className="font-semibold">{num(r.success_score)}</Td><Td><Badge>{r.tier}</Badge></Td>
                    <Td>{money(r.estimated_nil)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Top portal fits" action={<Link className="text-sm text-blue-600" href={`/portal${q}`}>Portal board →</Link>}>
          <Table>
            <thead><tr><Th>Player</Th><Th>Pos</Th><Th>From</Th><Th>Quality</Th><Th>Need</Th><Th>Est. NIL</Th><Th>Score</Th></tr></thead>
            <tbody>
              {portal.candidates.slice(0, 8).map((c) => (
                <tr key={c.candidate_id}>
                  <Td><PlayerLink id={c.athlete_id}>{name(c)}</PlayerLink></Td>
                  <Td>{c.pos_group}</Td><Td>{c.current_team}</Td>
                  <Td>{pct(c.quality)}</Td><Td>{num(100 * c.need, 0)}</Td><Td>{money(c.nil_value)}</Td>
                  <Td className="font-semibold">{num(c.default_score, 1)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
