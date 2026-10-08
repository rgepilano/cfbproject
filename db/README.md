Migration: add nil_millions

Files added:
- 0001_add_nil_millions.sql — ALTER TABLE to add `nil_millions` numeric column to `analytics.teams`.

Populate values from CSV:
- Use the script `web/scripts/import_nil.mjs` which reads `web/data/sideline-nil-2026.csv` and updates `analytics.teams.nil_millions`.

Steps:
1. Apply the SQL migration to your Postgres database (example):

   psql -h $PGHOST -U $PGUSER -d $PGDATABASE -f db/0001_add_nil_millions.sql

2. From the `web` folder, run the importer (requires PG_* env vars set):

   cd web
   node scripts/import_nil.mjs

The importer attempts exact case-insensitive matches and falls back to a simple LIKE-based heuristic. If any schools are missing after import, add an alias mapping in `web/scripts/import_nil.mjs` or update `analytics.teams` values to match the CSV school name.
