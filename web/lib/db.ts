import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const globalForPool = globalThis as unknown as { pgPool?: Pool };

function createPool() {
  // Prefer certificate from environment (for serverless platforms like Vercel).
  const envCa = process.env.PGSSLROOTCERT || process.env.PG_SSL_CA || process.env.RDS_CA_PEM;
  let ssl: { ca?: string } | undefined;
  if (envCa) {
    ssl = { ca: envCa };
  } else {
    // Fall back to local file for development. If missing in production, surface a clearer error.
    const certPath = path.join(process.cwd(), "certs", "rds-global-bundle.pem");
    if (fs.existsSync(certPath)) {
      ssl = { ca: fs.readFileSync(certPath, "utf8") };
    } else if (process.env.NODE_ENV === "production") {
      throw new Error(
        `Missing RDS CA certificate. Set environment variable PG_SSL_CA (contents of rds-global-bundle.pem) in your deployment platform, or include certs/rds-global-bundle.pem in the build.`,
      );
    }
  }

  const pool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl,
    // The UI never writes; enforce that even if the login has write access.
    options: "-c default_transaction_read_only=on",
    max: 5,
  });
  return pool;
}

export function getPool() {
  if (!globalForPool.pgPool) {
    globalForPool.pgPool = createPool();
  }
  return globalForPool.pgPool;
}

if (process.env.NODE_ENV !== "production") {
  // Eagerly create pool in dev so connection errors surface early.
  globalForPool.pgPool = globalForPool.pgPool ?? createPool();
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const pool = getPool();
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
