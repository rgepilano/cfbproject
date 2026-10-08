import { ParamSelect } from "@/components/ParamSelect";
import { Badge, Card, PlayerLink, Table, Td, Th } from "@/components/ui";
import { WatchButton } from "@/components/Watchlist";
import { getTeams, sql, getTeamNIL } from "@/lib/db";
import { DEFAULT_TEAM, money, name, num, param, pct, pick, POSITION_GROUPS, qs, type SearchParams } from "@/lib/util";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionUsername } from "@/lib/session";
import { getUserDefaultTeam } from "@/lib/users";

const SORTS = {
  priority: "retention_priority DESC NULLS LAST",
  transfer: "transfer_risk DESC NULLS LAST",
  nfl: "nfl_risk DESC NULLS LAST",
  leave: "leave_risk DESC NULLS LAST",
  value: "player_value DESC NULLS LAST",
  nil: "nil_value DESC NULLS LAST",
} as const;
type SortKey = keyof typeof SORTS;

type Row = Record<string, string | number | null>;

export default async function RetentionPage({ searchParams }: { searchParams: SearchParams }) {
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
  const g = param(sp, "group");
  const group = g && POSITION_GROUPS.includes(g) ? g : undefined;
  const sort = pick(param(sp, "sort"), Object.keys(SORTS) as SortKey[], "priority");

  // ORDER BY uses only whitelisted SORTS values; all user input goes through bind parameters.
  const rows = await sql<Row>(
    `SELECT athlete_id, first_name, last_name, position, pos_group, class_year, seasons_left_est, graduating,
            player_value, transfer_risk, transfer_tier, transfer_drivers, nfl_risk, nfl_tier, nfl_drivers,
            leave_risk, retention_priority, retention_rank, usage_share, production_pct, stars, nil_value, nil_drivers
     FROM analytics.departure_risk
     WHERE team = $1 AND ($2::text IS NULL OR pos_group = $2)
     ORDER BY graduating, ${SORTS[sort]}`,
    [team, group ?? null],
  );
  const base = { team, group };
  const highRisk = rows.filter((r) => r.transfer_tier === "High").length;
  const nflHigh = rows.filter((r) => r.nfl_tier === "High" || r.nfl_tier === "Medium").length;
  const graduating = rows.filter((r) => Number(r.graduating) === 1).length;
  const nilVal = await getTeamNIL(team);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Retention — {team}</h1>
          <div className="text-sm text-slate-600">Estimated NIL (2026): {nilVal ? `$${nilVal.toFixed(2)}M` : "—"}</div>
          <p className="text-sm text-slate-500">
            {highRisk} high transfer risk · {nflHigh} medium/high NFL early-entry risk · {graduating} out of eligibility.
            Retention priority = player value × position importance × transfer probability × scarcity.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ParamSelect name="team" value={team} options={teams} label="Team" />
          <ParamSelect name="group" value={group} options={POSITION_GROUPS} label="Group" allLabel="All" />
          <a className="text-sm text-blue-600" href={`/api/export?table=departure_risk&team=${encodeURIComponent(team)}`}>CSV</a>
        </div>
      </div>

      <Card title={`${rows.length} players`}>
        <Table>
          <thead>
            <tr>
              <Th>Player</Th><Th>Pos</Th><Th>Class</Th><Th>Seasons left</Th>
              <Th href={qs(base, { sort: "value" })} active={sort === "value"}>Value</Th>
              <Th href={qs(base, { sort: "nil" })} active={sort === "nil"}>Est. NIL</Th>
              <Th href={qs(base, { sort: "transfer" })} active={sort === "transfer"}>Transfer</Th>
              <Th href={qs(base, { sort: "nfl" })} active={sort === "nfl"}>NFL</Th>
              <Th href={qs(base, { sort: "leave" })} active={sort === "leave"}>Leave</Th>
              <Th href={qs(base, { sort: "priority" })} active={sort === "priority"}>Priority</Th>
              <Th>Why (top drivers)</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.athlete_id)} className={Number(r.graduating) === 1 ? "opacity-50" : ""}>
                <Td>
                  <WatchButton kind="player" id={String(r.athlete_id)} label={name(r)}
                    sub={`${r.position} · ${team}`} href={`/players/${r.athlete_id}`} />{" "}
                  <PlayerLink id={r.athlete_id}>{name(r)}</PlayerLink>
                </Td>
                <Td>{r.position}</Td>
                <Td>{num(r.class_year, 0)}</Td>
                <Td>{Number(r.graduating) === 1 ? "Final year" : num(r.seasons_left_est, 0)}</Td>
                <Td>{pct(r.player_value)}</Td>
                <Td><span title={String(r.nil_drivers ?? "")}>{money(r.nil_value)}</span></Td>
                <Td>{r.transfer_tier ? <Badge>{r.transfer_tier}</Badge> : null} {num(r.transfer_risk, 0)}</Td>
                <Td>{r.nfl_tier ? <Badge>{r.nfl_tier}</Badge> : "—"} {r.nfl_risk !== null ? num(r.nfl_risk, 0) : ""}</Td>
                <Td>{num(r.leave_risk, 0)}</Td>
                <Td className="font-semibold">{num(r.retention_priority)}</Td>
                <Td className="max-w-md truncate text-xs text-slate-500">
                  <span title={String(r.transfer_drivers ?? "")}>{r.transfer_drivers}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
