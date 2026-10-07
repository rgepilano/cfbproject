# CFB Project — Roster Pipeline & Analytics

Comprehensive project for scoring NCAA FBS rostered players on transfer risk, recruit projection, and NFL early-entry risk, with a Next.js web UI for exploration.

Contents
- `analytics/` — data pipeline, feature engineering, model training and scoring, scheduled runner, and outputs written into the `analytics` Postgres schema.
- `web/` — Next.js (app router, TypeScript) web UI that reads `analytics.*` tables and provides dashboards, exports, and a protected login gate.
- `db/`, `sql/` — database helpers and role/permission SQL (DB artifacts live in `db/roles.sql` or similar).

Key concepts
- Source schema: `ing` — original CFBD-style tables ingested from upstream (CFBD API or imports). Contains `rosters`, `stats`, `hsrecruits`, `portalplayers`, `coaches`, etc.
- Analytics schema: `analytics` — materialized, indexed tables produced by the scoring pipeline. Examples: `analytics.player_season`, `analytics.departure_risk`, `analytics.recruit_projection`, `analytics.portal_candidate`, `analytics.roster_pipeline`, `analytics.team`, `analytics.team_season`, `analytics.data_quality`.

High-level goals
- Build repeatable, auditable scoring pipeline for transfer risk and recruit/NFL projections.
- Surface model outputs in a protected Next.js UI for analysts and coaches.
- Log runs, data quality metrics, and detect distributional drift.

Quickstart (developer)
1. Clone the repo and open the workspace root.
2. Set up Python virtualenv (project uses Python 3.11+):
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1   # PowerShell on Windows
   pip install -r analytics/requirements.txt
   ```
3. Install web deps and run dev server:
   ```bash
   cd web
   npm ci
   npm run dev
   # UI available at http://localhost:3100 (or configured port)
   ```
4. Configure `.env.local` (see `web/.env.example`) with DB and app secrets. Don't commit secrets.
5. Run the analytics scoring locally (writes to the Postgres configured in env):
   ```powershell
   # from repo root
   Set-Location analytics
   C:\Path\To\python.exe score.py
   # or use provided run_scoring.ps1 wrapper
   ```

Environment variables (most important)
- Postgres: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE`.
- RDS CA (for secure connections): either commit `web/certs/rds-global-bundle.pem` or set `PG_SSL_CA` in deployment env.
- Auth/web: `AUTH_SECRET` (32+ chars), and either `APP_USERS` or `APP_USERNAME`/`APP_PASSWORD` for a legacy single user.
- CFBD import: `CFBD_API_KEY` (or `CFBD_KEY`) if you plan to run `analytics/cfbd_import.py`.

Project structure (short)
- `analytics/` — Python package with: `score.py` (orchestrator), `transfer_risk.py`, `recruit_projection.py`, `nfl_risk.py`, `cfbd_import.py`, `pipeline.py`, `db.py` (helpers), `output/` (logs and CSV artifacts), `tests/`.
- `web/` — Next 16 app router, server-only DB pool (`web/lib/db.ts`), `proxy.ts` auth gate, `lib/users.ts`, pages/components for dashboards and exports.

Models and data
- Transfer risk: GBM (LightGBM) baseline + logistic alternative, trained on roster→portal historical labels. Uses within-team usage share, depth rank, recruit pedigree, coach changes, incoming competition, production percentiles, distance-from-home, and more. Trained on seasons >= 2023; scored for SCORE_SEASON (configurable in `analytics/*.py`).
- Recruit projection: regression/class models to predict peak production percentile and contributor/impact outcomes; blends model + rating.
- NFL early-entry risk: model trained using CFBD draft picks and roster/draft join; predicts early-entry/draft likelihood.

Running & scheduling
- Local: run `analytics/score.py` using the project's venv Python. Logs are saved into `analytics/output/scoring_YYYYMMDD_HHMMSS.log`.
- Scheduled: `analytics/run_scoring.ps1` is a wrapper to schedule via Windows Task Scheduler (or convert to cron on Linux).

Deployment notes
- Web app deployed on Vercel: set environment variables in the Vercel project (DB creds, `AUTH_SECRET`, `PG_SSL_CA` if not including the PEM in the repo). The app needs runtime access to the `analytics` schema.
- The analytics pipeline runs on a host with DB access (can be local, EC2, container, or scheduled CI job). It requires credentials able to write into `analytics` schema only (read `ing`).

Security
- Rotate any secrets exposed earlier. Use Vercel environment variables or your secret manager for production. The web app enforces read-only `cfb_web` DB role in server DB connections.

Troubleshooting
- Build failures on Vercel caused by missing RDS CA: set `PG_SSL_CA` with PEM content or commit `web/certs/rds-global-bundle.pem` and ensure it's included in the build.
- `AUTH_SECRET` must be 32+ chars or login will fail. Use `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` to generate.
- If `web/` behaves like a submodule during initial clone, convert it to a normal folder (this repo already contains `web/` as tracked files).

Where things are written
- Analytics writes final tables into Postgres under `analytics.*`. Check `analytics/score.py` for exact table names and `analytics/output/` for CSVs and logs.

Contributing
- Run Python tests (`analytics/tests/`) with `pytest` in the venv. Run web unit/lint per `web/package.json` scripts.
- Update `WORKPLAN.md` with new milestones or notes.

If you'd like, I can:
- Add an examples section showing a sample query to list top portal candidates.
- Create a short ops playbook for rotating DB passwords and promoting releases.

