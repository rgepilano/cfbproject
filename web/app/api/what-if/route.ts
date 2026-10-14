import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getTeams, sqlWrite } from "@/lib/db";
import { getDepthChartYears } from "@/lib/depth-chart";
import { getSessionUsername, SESSION_COOKIE } from "@/lib/session";

const ENTRY_KEY = /^(?:roster-\d+|recruit-\d+|portal-\d+-\d+)$/;

export async function PUT(request: Request) {
  const username = await getSessionUsername((await cookies()).get(SESSION_COOKIE)?.value);
  if (!username) return NextResponse.json({ error: "Sign in to save a what-if board." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const body: unknown = await request.json().catch(() => null);
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const teamInput = input.team;
  const seasonInput = input.season;
  if (typeof teamInput !== "string" || teamInput.length > 120
    || typeof seasonInput !== "string" || !/^\d{4}$/.test(seasonInput)
    || typeof input.customOrder !== "boolean"
    || !Array.isArray(input.entryKeys) || input.entryKeys.length > 300
    || !input.entryKeys.every((key: unknown) => typeof key === "string" && ENTRY_KEY.test(key))
    || !Array.isArray(input.excludedKeys) || input.excludedKeys.length > 300
    || !input.excludedKeys.every((key: unknown) => typeof key === "string" && ENTRY_KEY.test(key))) {
    return NextResponse.json({ error: "Invalid what-if board." }, { status: 400 });
  }
  const [teams, years] = await Promise.all([getTeams(), getDepthChartYears()]);
  const team = teams.find((item) => item.toLowerCase() === teamInput.toLowerCase());
  if (!team || !years.includes(seasonInput)) return NextResponse.json({ error: "Select a valid team and season." }, { status: 400 });
  const entryKeys = [...new Set(input.entryKeys as string[])];
  const excludedKeys = [...new Set(input.excludedKeys as string[])];
  await sqlWrite(
    `INSERT INTO web.what_if_depth_chart (username, team, season, entry_keys, excluded_keys, custom_order, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, now())
     ON CONFLICT (username, team, season) DO UPDATE
       SET entry_keys = EXCLUDED.entry_keys, excluded_keys = EXCLUDED.excluded_keys,
           custom_order = EXCLUDED.custom_order, updated_at = now()`,
    [username, team, Number(seasonInput), JSON.stringify(entryKeys), JSON.stringify(excludedKeys), input.customOrder],
  );
  return NextResponse.json({ ok: true });
}