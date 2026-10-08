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

let _nilMap: Record<string, number> | null = null;
export async function getNILMap(): Promise<Record<string, number>> {
  if (_nilMap) return _nilMap;
  const p = require("node:path");
  const fs = require("node:fs");
  const f = p.join(process.cwd(), "web", "data", "sideline-nil-2026.csv");
  const out: Record<string, number> = {};
  if (!fs.existsSync(f)) {
    _nilMap = out;
    return out;
  }
  const text = fs.readFileSync(f, "utf8");
  const lines = text.split(/\r?\n/);
  // Find header line and parse CSV rows (simple CSV parser handling quoted fields)
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/(?:"([^"]*)")|([^,]+)/g);
    if (!m) continue;
    // fields: Rank, School, Conference, Tier, Value
    const fields = (m as string[]).map((s: string) => s.replace(/^"|"$/g, "").trim());
    if (fields.length < 5) continue;
    const school = fields[1];
    const value = Number(fields[4]);
    if (!Number.isNaN(value)) out[school.trim().toLowerCase()] = value;
  }
  _nilMap = out;
  return out;
}

export async function getTeamNIL(team: string, season = 2026): Promise<number | null> {
  if (!team) return null;
  // First, try to read from analytics.team_season.nil_amt for the requested season if available.
  try {
    const rows = await sql<{ nil_amt: number }>(
      `SELECT nil_amt FROM analytics.team_season WHERE lower(team) = lower($1) AND season = $2 LIMIT 1`,
      [team, season],
    );
    const v = rows[0]?.nil_amt;
    if (v !== undefined && v !== null) return Number(v);
  } catch (e) {
    // If the query fails (table missing or permission), fall back to CSV.
  }

  // Fallback: use CSV-based map (legacy). Keep previous normalization heuristics.
  const map = await getNILMap();
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/\([^)]*\)/g, "") // remove parentheticals
      .replace(/["'.,]/g, "")
      .replace(/&/g, "and")
      .replace(/\s+/g, " ")
      .trim();

  const key = team.trim().toLowerCase();
  if (map[key] != null) return map[key];

  const variants = [team, team.replace(/\s*\([^)]*\)\s*/g, "")].map((v) => normalize(v));
  for (const v of variants) {
    if (map[v] != null) return map[v];
  }

  // Try approximate contains match against normalized map keys
  const normalizedMap: Record<string, number> = {};
  for (const [k, val] of Object.entries(map)) normalizedMap[normalize(k)] = val;
  for (const v of variants) {
    for (const [mk, mv] of Object.entries(normalizedMap)) {
      if (mk.includes(v) || v.includes(mk)) return mv;
    }
  }

  return null;
}
