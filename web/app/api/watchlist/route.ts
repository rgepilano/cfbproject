import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql, sqlWrite } from "@/lib/db";
import { getSessionUsername, SESSION_COOKIE } from "@/lib/session";

type Item = { key: string; kind: "player" | "recruit"; id: string; label: string; sub?: string; href?: string };

async function currentUser() {
  const c = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSessionUsername(c);
}

function clean(v: unknown): Item | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown, max: number) => (typeof x === "string" && x.length <= max ? x : null);
  const key = str(o.key, 100), id = str(o.id, 50), label = str(o.label, 200);
  if (!key || !id || !label || (o.kind !== "player" && o.kind !== "recruit")) return null;
  const sub = str(o.sub, 200) ?? undefined;
  // Only same-site paths; the href is rendered as a link.
  const href = typeof o.href === "string" && /^\/(?!\/)[^\s]{0,200}$/.test(o.href) ? o.href : undefined;
  return { key, kind: o.kind, id, label, sub, href };
}

export async function GET() {
  const username = await currentUser();
  if (!username) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const rows = await sql<Item>(
    `SELECT item_key AS key, kind, item_id AS id, label, sub, href
     FROM web.watchlist WHERE username = $1 ORDER BY added_at`,
    [username],
  );
  return NextResponse.json({ items: rows.map((r) => ({ ...r, sub: r.sub ?? undefined, href: r.href ?? undefined })) });
}

export async function POST(request: Request) {
  const username = await currentUser();
  if (!username) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.items) ? body.items.slice(0, 500) : [];
  const items = raw.map(clean).filter((i): i is Item => !!i);
  if (items.length === 0) return NextResponse.json({ error: "no valid items" }, { status: 400 });
  await sqlWrite(
    `INSERT INTO web.watchlist (username, item_key, kind, item_id, label, sub, href)
     SELECT $1, k, kd, i, l, s, h
     FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) AS t(k, kd, i, l, s, h)
     ON CONFLICT (username, item_key) DO NOTHING`,
    [username, items.map((i) => i.key), items.map((i) => i.kind), items.map((i) => i.id), items.map((i) => i.label),
     items.map((i) => i.sub ?? null), items.map((i) => i.href ?? null)],
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const username = await currentUser();
  if (!username) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const key = new URL(request.url).searchParams.get("key");
  if (!key || key.length > 100) return NextResponse.json({ error: "bad key" }, { status: 400 });
  await sqlWrite("DELETE FROM web.watchlist WHERE username = $1 AND item_key = $2", [username, key]);
  return NextResponse.json({ ok: true });
}
