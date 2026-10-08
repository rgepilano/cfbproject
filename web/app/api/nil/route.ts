import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

// Latest estimated NIL value per athlete, for client pages (watchlist) that can't query the DB.
export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .filter((s) => /^\d{1,12}$/.test(s))
    .slice(0, 500);
  if (ids.length === 0) return NextResponse.json({});
  const rows = await sql<{ athlete_id: string; nil_value: number | null }>(
    `SELECT DISTINCT ON (athlete_id) athlete_id::text AS athlete_id, nil_value
     FROM analytics.player_nil WHERE athlete_id::text = ANY($1::text[]) ORDER BY athlete_id, season DESC`,
    [ids],
  );
  return NextResponse.json(Object.fromEntries(rows.map((r) => [r.athlete_id, r.nil_value])));
}
