This is the web frontend for the CFB analytics project. It reads scored outputs from the `analytics` Postgres schema and provides dashboards, player detail pages, CSV export, pipeline views, and a protected login gate for multi-user access.

Local development

1. Copy example env and fill secrets:

	- Create `web/.env.local` from `web/.env.example` and set the values below.

2. Install and run:

	```bash
	cd web
	npm ci
	npm run dev
	```

	The dev server uses Next's app router. By default the UI listens on port `3000` (or the port configured in `package.json` scripts).

Required environment variables

- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` — Postgres connection info.
- `PGSSLMODE` — use `require` or `verify-full` depending on your DB.
- `PG_SSL_CA` (optional) — PEM bundle for RDS root certificates. If not set, the app falls back to `web/certs/rds-global-bundle.pem` during development.
- `AUTH_SECRET` — HMAC secret used for session tokens (minimum 32 characters). Login will fail without it.
- `APP_USERS` or `APP_USERNAME`/`APP_PASSWORD` — user configuration used by `web/lib/users.ts`. `APP_USERS` is preferred (JSON/encoded format used by scripts/add-user.mjs).
	- Use `web/scripts/add-user.mjs` to add users. Example:

		```bash
		# add user 'admin' with default team 'ORE'
		cd web
		npm run add-user -- admin --team ORE
		# list users
		npm run add-user -- --list
		# remove a user
		npm run add-user -- --remove admin
		```

	- `APP_USERS` entries support an optional 4th field: `user:salt:hash:defaultTeam`. The add-user script saves the team when provided.

Important implementation notes

- Lazy DB pool: `web/lib/db.ts` creates the `pg.Pool` lazily at runtime (via `getPool()`) to avoid reading certs at Next build time. Do not import a pool at module scope in server components.
- Certificate handling: Vercel may limit env var sizes. If your `PG_SSL_CA` PEM exceeds the platform limit, commit `web/certs/rds-global-bundle.pem` into the repo and ensure `.gitignore` does not exclude it.
- Session handling: sessions are HMAC-signed with `AUTH_SECRET`. If `AUTH_SECRET` is missing or too short, `createSession()` will throw.

Running the analytics-backed flows locally

- The web UI expects analytics tables to exist in the configured Postgres database. Run `analytics/score.py` from the repo root (in the Python venv) to populate `analytics.*` tables.

Authentication and users

- `web/scripts/add-user.mjs` helps create `APP_USERS` entries. Alternatively set legacy `APP_USERNAME`/`APP_PASSWORD` for a single user.
- `web/lib/session.ts` validates and issues HMAC-signed session tokens; `web/lib/users.ts` manages user lookup and password checks.

You can fetch the current signed-in user and their default team from the frontend via the built-in API:

`GET /api/me` — returns `{ username, defaultTeam }` when authenticated.

Deployment on Vercel

- Add environment variables in the Vercel project settings: DB creds, `AUTH_SECRET`, and optionally `PG_SSL_CA`.
- If you commit `web/certs/rds-global-bundle.pem`, ensure it is present in the repo and not ignored.
- The app must be able to reach the Postgres host from Vercel. Configure RDS security groups or use a private VPC / Vercel integration as needed.

Troubleshooting

- Build-time errors referencing file reads or DB connections: ensure `web/lib/db.ts` is not imported at top-level in any server component that runs at build time. Use runtime calls to `getPool()` inside server handlers.
- Login fails with NEXT_REDIRECT: server actions should return `{ redirect }` object rather than calling `redirect()` inside the server action result; see `app/login/actions.ts` and `LoginForm.tsx` for the implemented pattern.
- `AUTH_SECRET` errors: regenerate a random secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and set the Vercel secret.

Where to look next

- Database pool: [web/lib/db.ts](web/lib/db.ts#L1)
- Login flow: [app/login/actions.ts](app/login/actions.ts#L1) and [app/login/LoginForm.tsx](app/login/LoginForm.tsx#L1)
- User management script: [web/scripts/add-user.mjs](scripts/add-user.mjs#L1)

If you want, I can also:
- Add a short guide to query examples that return the top transfer-risk players per team.
- Create a CI job that runs `analytics/score.py` and uploads CSV outputs to an S3 bucket on success.

