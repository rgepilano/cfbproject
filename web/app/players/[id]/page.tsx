import { notFound } from "next/navigation";
import { Badge, Card, Empty, Table, Td, Th } from "@/components/ui";
import { WatchButton } from "@/components/Watchlist";
import { sql } from "@/lib/db";
import { name, num, pct } from "@/lib/util";

type Row = Record<string, string | number | null>;

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) notFound();

  const [seasons, risk, portal] = await Promise.all([
    sql<Row>(
      `SELECT season, team, conference, position, pos_group, class_year, seasons_left_est, height, weight, home_state,
              recruit_year, stars, rating, usage_share, depth_rank, production_pct, prior_transfer, entered_portal
       FROM analytics.player_season WHERE athlete_id = $1 ORDER BY season`,
      [id],
    ),
    sql<Row>("SELECT * FROM analytics.departure_risk WHERE athlete_id = $1", [id]),
    sql<Row>(
      `SELECT season, origin, destination, eligibility, rating, stars, transfer_date, match
       FROM analytics.portal_entry WHERE athlete_id = $1 ORDER BY season`,
      [id],
    ),
  ]);
  if (seasons.length === 0) notFound();
  const latest = seasons[seasons.length - 1];
  const r = risk[0];
  const displayName = name(r ?? (await firstName(id)));

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">
          <WatchButton kind="player" id={id} label={displayName} sub={`${latest.position} · ${latest.team}`} href={`/players/${id}`} />{" "}
          {displayName}
        </h1>
        <p className="text-sm text-slate-500">
          {latest.position} · {latest.team} ({latest.conference}) · class year {num(latest.class_year, 0)} ·
          {" "}{num(latest.height, 0)}&quot; / {num(latest.weight, 0)} lb · home {latest.home_state ?? "—"} ·
          {" "}recruit {latest.recruit_year ?? "—"} ({num(latest.stars, 0)}★, {num(latest.rating, 4)})
        </p>
      </div>

      {r && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card title="Transfer risk">
            <div className="text-3xl font-bold">{num(r.transfer_risk, 0)}</div>
            <Badge>{r.transfer_tier}</Badge>
            <p className="mt-2 text-xs text-slate-500">{r.transfer_drivers}</p>
          </Card>
          <Card title="NFL early-entry risk">
            <div className="text-3xl font-bold">{r.nfl_risk === null ? "—" : num(r.nfl_risk, 0)}</div>
            {r.nfl_tier ? <Badge>{r.nfl_tier}</Badge> : <span className="text-xs text-slate-500">Not draft-eligible</span>}
            <p className="mt-2 text-xs text-slate-500">{r.nfl_drivers}</p>
          </Card>
          <Card title="Departure probability">
            <div className="text-3xl font-bold">{num(r.leave_risk, 0)}</div>
            <p className="text-xs text-slate-500">{Number(r.graduating) === 1 ? "Final year of eligibility" : `${num(r.seasons_left_est, 0)} seasons left (est.)`}</p>
          </Card>
          <Card title="Retention priority">
            <div className="text-3xl font-bold">{num(r.retention_priority)}</div>
            <p className="text-xs text-slate-500">
              #{num(r.retention_rank, 0)} on team · value {pct(r.player_value)} · {num(r.comparable_teammates, 0)} comparable teammates
            </p>
          </Card>
        </div>
      )}

      <Card title="Seasons">
        <Table>
          <thead>
            <tr><Th>Season</Th><Th>Team</Th><Th>Pos</Th><Th>Class</Th><Th>Usage share</Th><Th>Depth</Th><Th>Production pct</Th><Th>Entered portal after</Th></tr>
          </thead>
          <tbody>
            {seasons.map((s) => (
              <tr key={String(s.season)}>
                <Td>{s.season}</Td><Td>{s.team}</Td><Td>{s.position}</Td><Td>{num(s.class_year, 0)}</Td>
                <Td>{pct(s.usage_share)}</Td><Td>{num(s.depth_rank, 0)}</Td><Td>{pct(s.production_pct)}</Td>
                <Td>{s.entered_portal === null ? "—" : Number(s.entered_portal) === 1 ? "Yes" : "No"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="Portal history">
        {portal.length === 0 ? (
          <Empty>No matched portal entries.</Empty>
        ) : (
          <Table>
            <thead><tr><Th>Season</Th><Th>From</Th><Th>To</Th><Th>Status</Th><Th>Rating</Th><Th>Date</Th></tr></thead>
            <tbody>
              {portal.map((p, i) => (
                <tr key={i}>
                  <Td>{p.season}</Td><Td>{p.origin}</Td><Td>{p.destination || "Uncommitted"}</Td>
                  <Td>{p.eligibility}</Td><Td>{num(p.rating, 2)}</Td>
                  <Td>{p.transfer_date ? new Date(String(p.transfer_date)).toLocaleDateString() : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

async function firstName(id: string) {
  const rows = await sql<Row>(
    "SELECT first_name, last_name FROM analytics.player_season WHERE athlete_id = $1 ORDER BY season DESC LIMIT 1",
    [id],
  );
  return rows[0] ?? {};
}
