import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const globalForPool = globalThis as unknown as { pgPool?: Pool };

function createPool() {
  const pool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: { ca: fs.readFileSync(path.join(process.cwd(), "certs", "rds-global-bundle.pem"), "utf8") },
    // The UI never writes; enforce that even if the login has write access.
    options: "-c default_transaction_read_only=on",
    max: 5,
  });
  return pool;
}

export const pool = globalForPool.pgPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForPool.pgPool = pool;

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function tableExists(name: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }>("SELECT to_regclass($1) IS NOT NULL AS ok", [`analytics.${name}`]);
  return rows[0]?.ok ?? false;
}

export async function getTeams(): Promise<string[]> {
  const rows = await sql<{ team: string }>("SELECT DISTINCT team FROM analytics.departure_risk ORDER BY team");
  return rows.map((r) => r.team);
}
