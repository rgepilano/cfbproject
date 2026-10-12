import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUsername, SESSION_COOKIE } from "@/lib/session";
import { getUserDefaultTeam } from "@/lib/users";
import { getTeams } from "@/lib/db";
import { DEFAULT_TEAM } from "@/lib/util";
import { getPlayerBrief } from "@/lib/player-brief";

export const maxDuration = 60;
const requests = new Map<string, { count: number; expires: number }>();

export async function POST(request: Request) {
  const username = await getSessionUsername((await cookies()).get(SESSION_COOKIE)?.value);
  if (!username) return NextResponse.json({ error: "Sign in to generate a player brief." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const body: unknown = await request.json().catch(() => null);
  const id = body && typeof body === "object" ? (body as Record<string, unknown>).id : null;
  if (typeof id !== "string" || !/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "Invalid player ID." }, { status: 400 });
  const now = Date.now();
  for (const [key, value] of requests) if (value.expires <= now) requests.delete(key);
  const limit = requests.get(username) ?? { count: 0, expires: now + 10 * 60 * 1000 };
  if (limit.count >= 10) return NextResponse.json({ error: "Brief request limit reached. Try again in 10 minutes." }, { status: 429 });
  limit.count++;
  requests.set(username, limit);
  try {
    const teams = await getTeams();
    const preferred = getUserDefaultTeam(username) ?? DEFAULT_TEAM;
    const team = teams.find((item) => item.toLowerCase() === preferred.toLowerCase()) ?? DEFAULT_TEAM;
    const result = await getPlayerBrief(id, team);
    if (!result) return NextResponse.json({ error: "Player not found." }, { status: 404 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    const message = code === "OPENAI_NOT_CONFIGURED" ? "OpenAI is not configured on the server."
      : status === 401 ? "OpenAI rejected the API credentials. Check the server configuration."
      : status === 429 ? "OpenAI quota or rate limit reached. Check billing or try again later."
      : "Could not generate or save the brief. Please try again.";
    console.error("Player brief failed", { status, category: code === "OPENAI_NOT_CONFIGURED" ? code : "generation_or_storage" });
    return NextResponse.json({ error: message }, { status: 503 });
  }
}