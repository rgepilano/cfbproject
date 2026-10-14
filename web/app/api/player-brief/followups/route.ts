import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getTeams, sql, sqlWrite } from "@/lib/db";
import { getSessionUsername, SESSION_COOKIE } from "@/lib/session";

type FollowUp = { item: string; owner: string; note: string; status: "open" | "verified"; updatedAt: Date };

async function currentUser() {
  return getSessionUsername((await cookies()).get(SESSION_COOKIE)?.value);
}

function validBriefKey(id: unknown, team: unknown, scenario: unknown) {
  return typeof id === "string" && /^\d{1,12}$/.test(id)
    && typeof team === "string" && team.length <= 120
    && (scenario === "retention" || scenario === "acquisition");
}

export async function GET(request: Request) {
  const username = await currentUser();
  if (!username) return NextResponse.json({ error: "Sign in to view staff follow-ups." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const id = params.get("id"), team = params.get("team"), scenario = params.get("scenario");
  if (!validBriefKey(id, team, scenario)) return NextResponse.json({ error: "Invalid follow-up query." }, { status: 400 });
  const items = await sql<FollowUp>(
    `SELECT item, owner, note, status, updated_at AS "updatedAt"
     FROM web.player_brief_followup
     WHERE username = $1 AND athlete_id = $2 AND team = $3 AND scenario = $4
     ORDER BY updated_at DESC`, [username, id, team, scenario],
  );
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const username = await currentUser();
  if (!username) return NextResponse.json({ error: "Sign in to save staff follow-ups." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const body: unknown = await request.json().catch(() => null);
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (!validBriefKey(input.id, input.team, input.scenario)
    || typeof input.item !== "string" || !input.item.trim() || input.item.length > 2000
    || (input.owner !== undefined && (typeof input.owner !== "string" || input.owner.length > 100))
    || (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 2000))
    || (input.status !== "open" && input.status !== "verified")) {
    return NextResponse.json({ error: "Invalid follow-up." }, { status: 400 });
  }
  const teams = await getTeams();
  const team = teams.find((value) => value.toLowerCase() === String(input.team).toLowerCase());
  if (!team) return NextResponse.json({ error: "Select a valid team." }, { status: 400 });
  const saved = await sqlWrite<FollowUp>(
    `INSERT INTO web.player_brief_followup (username, athlete_id, team, scenario, item, owner, note, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (username, athlete_id, team, scenario, item) DO UPDATE
       SET owner = EXCLUDED.owner, note = EXCLUDED.note, status = EXCLUDED.status, updated_at = now()
     RETURNING item, owner, note, status, updated_at AS "updatedAt"`,
    [username, input.id, team, input.scenario, input.item.trim(), input.owner ?? "", input.note ?? "", input.status],
  );
  return NextResponse.json({ item: saved[0] });
}