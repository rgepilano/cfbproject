#!/usr/bin/env node
/**
 * import_nil.mjs
 *
 * Reads web/data/sideline-nil-2026.csv and updates analytics.teams.nil_millions
 * with the numeric NIL estimate (in millions).
 *
 * Usage:
 *   cd web
 *   node scripts/import_nil.mjs
 *
 * Requires PG connection environment variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT).
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

async function main() {
  const csvPath = path.join(process.cwd(), 'data', 'sideline-nil-2026.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found at', csvPath);
    process.exit(1);
  }
  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    // simple CSV parse (handles quoted fields)
    const m = line.match(/(?:"([^"]*)")|([^,]+)/g);
    if (!m) continue;
    const fields = m.map(s => s.replace(/^"|"$/g, '').trim());
    if (fields.length < 5) continue;
    const school = fields[1];
    const value = Number(fields[4]);
    if (Number.isFinite(value)) rows.push({ school, value });
  }

  const client = new Client();
  await client.connect();

  const updated = [];
  const missing = [];

  for (const { school, value } of rows) {
    // 1) try exact case-insensitive match
    let res = await client.query(
      `UPDATE analytics.teams SET nil_millions = $1 WHERE lower(team) = lower($2) RETURNING team`,
      [value, school]
    );
    if (res.rowCount > 0) {
      updated.push({ school, value, matched: res.rows.map(r => r.team) });
      continue;
    }

    // 2) try removing parentheticals from school and match
    const simple = school.replace(/\s*\([^)]*\)\s*/g, '').trim();
    res = await client.query(
      `UPDATE analytics.teams SET nil_millions = $1 WHERE lower(team) = lower($2) RETURNING team`,
      [value, simple]
    );
    if (res.rowCount > 0) {
      updated.push({ school, value, matched: res.rows.map(r => r.team) });
      continue;
    }

    // 3) fallback: LIKE matches (contains)
    res = await client.query(
      `UPDATE analytics.teams SET nil_millions = $1 WHERE lower(team) LIKE '%' || lower($2) || '%' RETURNING team`,
      [value, simple]
    );
    if (res.rowCount > 0) {
      updated.push({ school, value, matched: res.rows.map(r => r.team) });
      continue;
    }

    missing.push({ school, value });
  }

  console.log('Updated rows:', updated.length);
  if (updated.length > 0) console.log(updated.slice(0,10));
  console.log('Missing mappings (not updated):', missing.length);
  if (missing.length > 0) console.log(missing.slice(0,10));

  await client.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
