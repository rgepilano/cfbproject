import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUsername, SESSION_COOKIE } from "@/lib/session";
import { getUserDefaultTeam } from "@/lib/users";

export async function GET() {
  const c = (await cookies()).get(SESSION_COOKIE)?.value;
  const username = await getSessionUsername(c);
  if (!username) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({ username, defaultTeam: getUserDefaultTeam(username) });
}
