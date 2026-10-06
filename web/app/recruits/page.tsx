import Link from "next/link";
import { ParamSelect } from "@/components/ParamSelect";
import { Badge, Card, Table, Td, Th } from "@/components/ui";
import { WatchButton } from "@/components/Watchlist";
import { sql } from "@/lib/db";
import { num, param, pct, pick, POSITION_GROUPS, qs, type SearchParams } from "@/lib/util";

const PAGE_SIZE = 50;
const SORTS = {
  success: "success_score DESC NULLS LAST",
  impact: "p_impact DESC NULLS LAST",
  rating: "rating DESC NULLS LAST",
  draft: "p_drafted DESC NULLS LAST",
} as const;
type SortKey = keyof typeof SORTS;
const TIERS = ["Elite", "High", "Solid", "Developmental"];

type Row = Record<string, string | number | null>;

export default async function RecruitsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const g = param(sp, "group");
  const group = g && POSITION_GROUPS.includes(g) ? g : undefined;
  const t = param(sp, "tier");
  const tier = t && TIERS.includes(t) ? t : undefined;
  const state = param(sp, "state")?.slice(0, 3);
  const committed = param(sp, "committed")?.slice(0, 80);
  const sort = pick(param(sp, "sort"), Object.keys(SORTS) as SortKey[], "success");
  const page = Math.max(1, Number(param(sp, "page") ?? 1) || 1);

  const where = `($1::text IS NULL OR pos_group = $1) AND ($2::text IS NULL OR tier = $2)
                 AND ($3::text IS NULL OR state = $3) AND ($4::text IS NULL OR committed_to = $4)`;
  const args = [group ?? null, tier ?? null, state ?? null, committed ?? null];
  const [rows, count, states, schools, meta] = await Promise.all([
    sql<Row>(
      `SELECT recruit_id, name, position, pos_group, high_school, city, state, committed_to, stars, rating, ranking,
              height, weight, success_score, tier, position_rank, p_contributor, p_impact, p_drafted, basis, comparables
       FROM analytics.recruit_projection WHERE ${where}
       ORDER BY ${SORTS[sort]} LIMIT ${PAGE_SIZE} OFFSET $5`,
      [...args, (page - 1) * PAGE_SIZE],
    ),
    sql<{ n: string }>(`SELECT count(*) AS n FROM analytics.recruit_projection WHERE ${where}`, args),
    sql<{ state: string }>("SELECT DISTINCT state FROM analytics.recruit_projection WHERE state IS NOT NULL ORDER BY 1"),
    sql<{ committed_to: string }>(
      "SELECT DISTINCT committed_to FROM analytics.recruit_projection WHERE committed_to IS NOT NULL ORDER BY 1"),
    sql<{ class_year: string }>("SELECT max(class_year) AS class_year FROM analytics.recruit_projection"),
  ]);
  const total = Number(count[0]?.n ?? 0);
  const base = { group, tier, state, committed, sort };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{meta[0]?.class_year} Recruit Board</h1>
          <p className="text-sm text-slate-500">
            Success score blends projected peak production percentile, impact probability, and recruit rating,
            projected as if each recruit joins a typical Power 4 program. OL/LS use rating only.
          </p>
        </div>
        <a className="text-sm text-blue-600" href="/api/export?table=recruit_projection">CSV</a>
      </div>

      <div className="flex flex-wrap gap-3">
        <ParamSelect name="group" value={group} options={POSITION_GROUPS} label="Group" allLabel="All" />
        <ParamSelect name="tier" value={tier} options={TIERS} label="Tier" allLabel="All" />
        <ParamSelect name="state" value={state} options={states.map((s) => s.state)} label="State" allLabel="All" />
        <ParamSelect name="committed" value={committed} options={schools.map((s) => s.committed_to)} label="Committed" allLabel="All" />
      </div>

      <Card title={`${total} recruits`}>
        <Table>
          <thead>
            <tr>
              <Th>Recruit</Th><Th>Pos</Th><Th>From</Th><Th>Committed</Th><Th>Stars</Th>
              <Th href={qs(base, { sort: "rating" })} active={sort === "rating"}>Rating</Th>
              <Th>Ht/Wt</Th>
              <Th href={qs(base, { sort: "success" })} active={sort === "success"}>Success</Th>
              <Th>Tier</Th><Th>Pos rank</Th><Th>P(contrib.)</Th>
              <Th href={qs(base, { sort: "impact" })} active={sort === "impact"}>P(impact)</Th>
              <Th href={qs(base, { sort: "draft" })} active={sort === "draft"}>P(drafted)</Th>
              <Th>Comparable past recruits</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.recruit_id)}>
                <Td className="font-medium">
                  <WatchButton kind="recruit" id={String(r.recruit_id)} label={String(r.name)}
                    sub={`${r.position} · ${r.state ?? ""} · ${r.committed_to ?? "uncommitted"} · score ${num(r.success_score)}`} />{" "}
                  {r.name}
                </Td>
                <Td>{r.position}</Td>
                <Td className="text-xs">{r.city}, {r.state}</Td>
                <Td>{r.committed_to ?? "—"}</Td>
                <Td>{num(r.stars, 0)}</Td>
                <Td>{num(r.rating, 4)}</Td>
                <Td className="text-xs">{num(r.height, 1)} / {num(r.weight, 0)}</Td>
                <Td className="font-semibold">{num(r.success_score)}</Td>
                <Td><Badge>{r.tier}</Badge></Td>
                <Td>{num(r.position_rank, 0)}</Td>
                <Td>{pct(r.p_contributor)}</Td>
                <Td>{pct(r.p_impact)}</Td>
                <Td>{pct(r.p_drafted)}</Td>
                <Td className="max-w-sm truncate text-xs text-slate-500"><span title={String(r.comparables ?? "")}>{r.comparables}</span></Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="mt-3 flex items-center gap-3 text-sm">
          {page > 1 && <Link className="text-blue-600" href={qs(base, { page: String(page - 1) })}>← Prev</Link>}
          <span className="text-slate-500">Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
          {page * PAGE_SIZE < total && <Link className="text-blue-600" href={qs(base, { page: String(page + 1) })}>Next →</Link>}
        </div>
      </Card>
    </>
  );
}
