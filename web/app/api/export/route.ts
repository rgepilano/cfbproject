import { sql } from "@/lib/db";

// Only these tables can be exported; the name is never taken from user input directly.
const TABLES = {
  departure_risk: { order: "team, retention_priority DESC", teamFilter: true },
  recruit_projection: { order: "success_score DESC", teamFilter: false },
  portal_candidate: { order: "quality DESC", teamFilter: false },
  roster_pipeline: { order: "team, horizon, pos_group", teamFilter: true },
} as const;
type TableName = keyof typeof TABLES;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Prevent spreadsheet formula injection.
  if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const table = url.searchParams.get("table") as TableName | null;
  if (!table || !(table in TABLES)) return new Response("Unknown table", { status: 400 });
  const cfg = TABLES[table];
  const team = cfg.teamFilter ? url.searchParams.get("team") : null;

  const rows = cfg.teamFilter
    ? await sql(`SELECT * FROM analytics.${table} WHERE ($1::text IS NULL OR team = $1) ORDER BY ${cfg.order}`, [team])
    : await sql(`SELECT * FROM analytics.${table} ORDER BY ${cfg.order}`);
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const body = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
  const file = `${table}${team ? `_${team.replace(/[^A-Za-z0-9]+/g, "_")}` : ""}.csv`;
  return new Response(body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"` },
  });
}
