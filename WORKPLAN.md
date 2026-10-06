# CFB Player Analytics — Work Plan

Goal: Keep a healthy roster pipeline by answering three questions with data from the `ing` schema (database `postgres`), shown in a **Next.js** web UI:

| Question | Model | Population |
|---|---|---|
| Who in the current HS class will succeed? | **Recruit Success Projection** | 2027 HS class (current cycle) |
| Who might leave, and who should we fight to keep? | **Departure Risk** = Transfer Risk + NFL Early-Entry Risk → **Retention Priority** | Rostered players with eligibility remaining |
| Who should we add from the portal? | **Portal Acquisition Score** | Current portal entrants (+ high-risk players elsewhere as a watch list) |

These roll up into a **Roster Pipeline** view per team: projected departures vs. incoming talent by position, for the next 1–3 seasons.

---

## Recommended Stack

| Layer | Choice | Why |
|---|---|---|
| Data / modeling | Python 3.11+, `pandas`, `scikit-learn`, `xgboost`/`lightgbm`, `SQLAlchemy`, `psycopg` | Fast iteration on features + models |
| Notebooks | Jupyter (VS Code) | Exploratory analysis |
| Score storage | New Postgres schema `analytics` | Keeps source data untouched; UI reads precomputed scores |
| Scheduling | Python CLI script (cron / Task Scheduler / GitHub Actions) | Re-score nightly or weekly |
| Web app | Next.js (App Router) + TypeScript | Server components query DB directly |
| DB access (web) | Drizzle ORM or Prisma (introspect existing schema) | Type-safe queries |
| UI | Tailwind CSS + shadcn/ui, TanStack Table, Recharts | Sortable tables, charts, player cards |
| Auth (optional) | Auth.js (NextAuth) | If data is non-public |

---

## Repo Layout (as built)

```
CFBProject/
├─ analytics/
│  ├─ db.py                   # read-only query() + write_table() to analytics schema (PG* vars from .env)
│  ├─ cfbd_import.py          # CFBD API -> analytics.cfbd_team_location, cfbd_draft_pick, cfbd_roster_history
│  ├─ transfer_risk.py        # player-season features + transfer model
│  ├─ nfl_risk.py             # NFL early-entry model (heuristic until draft picks imported)
│  ├─ recruit_projection.py   # HS recruit success projection
│  ├─ pipeline.py             # departure risk, retention priority, roster pipeline, portal candidates
│  ├─ score.py                # orchestrator: run all models, publish analytics.* tables, log model_run
│  ├─ run_scoring.ps1         # scheduled-job wrapper (logs to analytics/output)
│  ├─ profile.py, profile2.py # data profiling
│  ├─ tests/                  # pytest unit tests for feature builders
│  └─ output/                 # CSV/JSON/log output (git-ignored)
├─ web/                       # Next.js 16 app (App Router, Tailwind, pg)
└─ .env                       # PG* + CFBD_API_KEY (never commit)
```

---

## Source Data Assessment (`ing` schema)

The data matches the CollegeFootballData.com (CFBD) API structure.

| Table | Grain | Key columns | Use |
|---|---|---|---|
| `rosters` | player × season | `id` (athlete id), `"Season"`, `team`, `year` (class 1–5), `position`, height/weight, home city/state/lat/long, `"recruitIds"` | Core player-season spine |
| `stats` | player × season × category × statType (long format) | `"playerId"`, `season`, `team`, `category`, `"statType"`, `stat` | Production / playing-time proxy |
| `hsrecruits` | recruit | `id`, `"athleteId"`, `year`, `stars`, `rating`, `ranking`, `position`, height/weight, `"committedTo"`, `"recruitType"`, hometown | Recruit features + historical outcomes |
| `portalplayers` | portal entry | `season`, first/last name, `position`, `origin`, `destination`, `"transferDate"`, `rating`, `stars`, `eligibility` | **Label** for transfer risk; portal target pool |
| `coaches` | head coach × team × year | `"coach.id"`, `"team.school"`, `year`, W/L, SP+ | Coaching change, team strength |
| `teams` | team | `id`, `school`, `conference`, `classification`, `location` | Team dimension, campus location |
| `allplayers` | player | `id`, `"recruitIds"`, names | Athlete ↔ recruit crosswalk |

**Join paths**
- Player: `rosters.id` = `stats."playerId"` = `hsrecruits."athleteId"` = `allplayers.id`; `rosters."recruitIds"` / `allplayers."recruitIds"` = `hsrecruits.id`
- Team (by **school name string**): `rosters.team` = `stats.team` = `teams.school` = `coaches."team.school"` = `portalplayers.origin/destination` = `hsrecruits."committedTo"`
- Portal → player: **no id**; must match on normalized first/last name + `origin` = roster `team` + position + season.

**Issues to handle**
- No primary keys, foreign keys, or indexes; every column nullable.
- Mixed-case and dotted column names need double quotes in SQL (`"Season"`, `"team.school"`).
- `rosters` has both `"Season"` and `year` (class year) — confirm meaning.
- `recruitIds` is `integer` (in the API it is an array) — only one recruit id may be kept.
- Numeric/date values stored as text: `coaches."winPercentage"`, `srs`, `preseasonRank`; `portalplayers."transferDate"`.
- JSON stored as `varchar`: `coaches.recruiting`, `teamMetrics`, `scoring`, etc.; `teams.location`, `logos`; `hsrecruits."hometownInfo"` → cast to `jsonb`.
- Height units differ (`rosters.height` integer vs `hsrecruits.height` real) — verify both are inches.
- **No snap counts, depth charts, redshirt flag, or player-level draft data.** Playing time and eligibility must be approximated (see Phase 1).

### Profiling Results (run `analytics/profile.py`, `analytics/profile2.py`)

| Area | Finding | Decision |
|---|---|---|
| Coverage | `rosters` 2024–2026 (FBS only, ~134–138 teams, ~16k players/season); `stats` 2023–2026; `portalplayers` 2023–2026; `hsrecruits` 2018–2027; `coaches` 2023–2026 | Model population = FBS |
| Empty rows | 31,385 `rosters` rows are completely blank | Filter out (`id IS NOT NULL`) |
| Bad class year | `rosters.year` has 44 × `0` and ~111 values like `2024` | Treat as unknown; infer from history |
| Duplicates | 19 duplicate `id` + `"Season"` groups in `rosters` | De-duplicate in `player_season` |
| Portal season | Portal `season` S = transfers *into* season S (entries Oct S−1 → Aug S) | Label: roster S → portal S+1 |
| Portal match | Exact name + origin match to prior-season roster: 3,229 / 4,499 (2025), 3,186 / 4,471 (2026) ≈ 72% | Add fuzzy matching to raise rate |
| Portal fields | ~700–980 per season have no destination; 407 `Withdrawn` | Blank destination = uncommitted; flag withdrawn |
| Stats ↔ roster | 2025 FBS stat players: 8,664 / 8,766 match `rosters` (99%); non-FBS stats don't match | Ignore non-FBS stats except as transfer-in history |
| Recruits | `"athleteId"` present for ~60–80% of 2019–2026; 2027 class has none (not enrolled yet); 5,622 unrated; `rating` 0–1 scale | 2027 class = scoring population; 2020–2023 classes = training |
| JSON columns | **Every** value in `teams.location`, `hsrecruits."hometownInfo"`, `coaches.recruiting`/`teamMetrics` (and likely other object columns) is the literal text `[Record]` — data was lost during import | Re-import these columns from CFBD flattened (at minimum team lat/long) |
| Coaches | 2026 rows have 0 games and blank win% (current season); some team-years have >1 coach (mid-season change) | New-HC flag available for 2024–2026 |
| Home location | ~94% of roster rows have home lat/long | Usable for distance-from-home once team lat/long is re-imported |
| Performance | Correlated joins across `stats` (509k rows) are slow; no indexes | Materialize `analytics` tables with indexes first |

**Resulting model timeline**
- **Transfer risk:** train on roster 2024 → portal 2025; validate on roster 2025 → portal 2026; score roster 2026 → 2027 portal window. Prior-season usage uses 2023–2025 stats.
- **Recruit rating:** train on 2020–2023 classes (outcomes observed in 2023–2026 stats/rosters); score 2027 class (and 2026 freshmen).
- **Portal targets:** current pool = 2026 portal entries without destination, plus 2026 high-risk roster players.

---

## Phase 0 — Discovery & Setup

- [x] Export schema column list (`ingschema.csv`).
- [x] Python env + read-only DB access (`analytics/db.py`, credentials in `.env`).
- [x] Profile tables, season coverage, match rates, portal season convention (see Profiling Results).
- [ ] **Rotate the database password** (it was shared in chat) and update `.env` and `web/.env.local`. *(user)*
- [x] Re-import JSON columns lost as `[Record]` — `analytics.cfbd_team_location` (682 teams; all 138 FBS with lat/long/state). Enables distance-from-home and home-state portal fit.
- [x] **Import NFL draft picks** — `analytics.cfbd_draft_pick` (1,806 picks, 2020–2026; ~98% link to roster athlete ids from 2022 on).
- [x] Create a **read-only** Postgres role for the web app and a separate write role for the scoring job — `db/roles.sql` (applied): `cfb_web` (SELECT on analytics + `ing.teams`, read-only sessions) and `cfb_scoring` (reads `ing`, owns `analytics`). Scoring switches to `cfb_scoring` automatically via `SET ROLE`. **You still need to set both passwords** (`ALTER ROLE ... PASSWORD`) and point `web/.env.local` at `cfb_web`.
- [x] Confirm whether more historical rosters (pre-2024) can be loaded — yes, CFBD `/roster`; `cfbd_import.py --rosters` loads 2021–2023 into `analytics.cfbd_roster_history` (71,564 rows; FBS rows used). Transfer risk now trains on 2023 + 2024 (28,696 rows).

**Exit criteria:** Data issues logged with decisions; JSON re-import planned.

---

## Phase 1 — Data Foundation

Built in Python (pandas) by `score.py` and published as tables; `ing` is untouched.

- [x] Create `analytics` schema (`ing` stays read-only). Materialized tables with indexes.
- [x] `analytics.team` — FBS teams + conference; lat/long/state columns join in automatically once `cfbd_team_location` is imported.
- [x] `analytics.player_season` — one row per `athlete_id` × season (2024–2026), de-duplicated, with eligibility estimate (5-year clock from recruit class, else class year), recruit link, usage/production, portal label.
- [x] `analytics.player_season_stats` / `player_usage` — folded into `player_season` (usage share, usage percentile, depth rank, production percentile, prior-season values).
- [x] `analytics.team_season` — head coach, new-HC flag, mid-season change, W/L, SP+, SP+ change.
- [x] `analytics.portal_entry` — all portal rows with parsed date, matched `athlete_id`, match type (exact / first-initial).
- [x] `analytics.recruit_projection` — 2027 class with features and scores (training recruits stay in memory).
- [x] Data-quality checks — `analytics.data_quality`, refreshed each run.

**Exit criteria:** Base views return correct, de-duplicated data; spot-checked against known players.

---

## Phase 2 — Algorithms

Start each model with a **transparent rule-based/weighted baseline**, then replace or blend with an ML model once validated. Baselines ship to the UI early; ML improves accuracy later.

### 2a. Departure Risk (players with eligibility remaining)

Two separate models, because the causes differ, combined into one departure probability:

$$P(\text{leave}) = 1 - \big(1 - P(\text{transfer})\big)\big(1 - P(\text{NFL early entry})\big)$$

Players out of eligibility are **certain departures** (shown in the pipeline, not scored).

#### 2a-i. Transfer Risk

**Population:** `analytics.player_season` rows with estimated eligibility remaining > 0.

**Target:** Player on roster for team T in season S appears in `analytics.portal_entry` with `origin` = T in the following portal window (season S+1 per confirmed convention).

**Features (all from data that exists):**
- **Usage:** position-group volume share and depth rank this season; change vs. last season (`player_usage`)
- **Production:** per-position stats percentile vs. teammates and vs. conference (`stats`)
- **Pedigree vs. role:** `hsrecruits.stars`/`rating` vs. usage (high-star, low-usage = higher risk)
- **Incoming competition:** count and avg rating of new `hsrecruits` (`"committedTo"` = team) and incoming `portalplayers` (`destination` = team) at same position
- **Coaching:** `new_head_coach` flag, coach tenure (`coaches`)
- **Team:** win% change, SP+ change, conference
- **Player:** class year, eligibility remaining, seasons with program, distance from home (`rosters` home lat/long ↔ `teams.location`), prior transfer (has earlier portal entry)

**Approach:**
1. Baseline: weighted points model (low usage share + high pedigree + new head coach + incoming competition).
2. ML: gradient-boosted classifier (LightGBM/XGBoost) with **time-based split** (train on seasons ≤ N-1, test on N) to avoid leakage.
3. Calibrate probabilities (isotonic/Platt) → output 0–100 score + risk tier (Low/Med/High).
4. Explainability: SHAP top-3 drivers per player, stored alongside score.

**Metrics:** ROC-AUC, PR-AUC (portal entry is imbalanced), calibration curve, precision@top-N.

**Status (v1, `analytics/transfer_risk.py`):** trained on roster 2024 → portal 2025, validated on 2025 → 2026 (base rate 22.4%).

| Model | ROC-AUC | PR-AUC | Precision top 10% |
|---|---|---|---|
| Baseline points (fitted weights) | 0.597 | 0.287 | 0.313 |
| Logistic | 0.701 | 0.385 | 0.441 |
| **LightGBM (chosen)** | **0.717** | **0.406** | **0.468** |

(After adding 2023 rosters + distance from home; previously 0.705 / 0.398.) Portal → roster match 75% (exact + first-initial). Drivers are LightGBM SHAP contributions (`pred_contrib`). Baseline points are fitted logistic coefficients × 10. Usage and production are within-season percentiles/shares, so partial 2026 stats stay comparable. Published to `analytics.departure_risk`.

#### 2a-ii. NFL Early-Entry Risk

**Population:** draft-eligible players with eligibility remaining. NFL rule: 3 years removed from high school → eligible after season S when `S − hsrecruits.year ≥ 2` (fallback: class year ≥ 3).

**Target:** drafted with eligibility remaining (from imported draft picks). Undrafted early declarations are not in CFBD data — a known gap.

**Features:** production percentile by position (FBS-wide and conference), recruit `rating`/`stars`, size for position (height/weight z-score), team SP+ (exposure / competition level), usage share, class year, prior-season trend.

**Approach:**
1. Baseline (works before draft data is imported): draft-eligible AND top-5% production at position AND (4–5 star OR elite size) → High; scaled score below that.
2. ML: classifier trained on 2023–2025 seasons → following draft; small positive class (~100–150 early entrants per year), so keep the model simple (logistic regression / shallow GBM).

**Metrics:** precision/recall on early entrants, precision@top-50.

**Status:** `analytics/nfl_risk.py`, now trained on draft picks (logistic regression, train 2023–2024 → validate 2025 season / 2026 draft): ROC-AUC 0.944, PR-AUC 0.460, precision@top-50 0.76 (heuristic baseline: 0.866 / 0.172). ~253 expected early entrants in the 2026 roster.

#### 2a-iii. Retention Priority

Ranks who to spend retention effort (NIL, role, development) on:

$$\text{Retention Priority} = \text{Player Value} \times P(\text{leave}) \times \text{Replaceability}^{-1}$$

- **Player Value:** current production percentile + projected next-season value (recruit pedigree for young players).
- **Replaceability:** depth behind him at the position + incoming recruits/transfers at the position.
- Only P(transfer) is actionable for retention; NFL risk is shown for planning.

**Status:** implemented in `analytics/pipeline.py`, with position importance (specialists down-weighted) and scarcity = 1 / (1 + comparable teammates + incoming 80+ recruits).

### 2b. Recruit Success Projection (2027 HS class)

**Target (historical outcome):** link past recruits via `"athleteId"` → `rosters`/`stats` and compute a college outcome: career production percentile within position group, plus seasons with meaningful usage share ("became a contributor/starter"). Transferring out (portal) is tracked as a secondary outcome.

**Features available:** `stars`, `rating`, `ranking`, position, height, weight (z-scored within position), `"recruitType"` (HS/JUCO/Prep), state/region (`stateProvince`, `hometownInfo`), committed school strength (SP+/conference from `coaches`/`teams`).

**Not available:** speed/combine data, HS stats, offer lists — note as future data sources.

**Approach:**
1. Baseline: position-normalized composite (`rating` + measurables z-scores + commit school strength).
2. ML: regression on college outcome, trained on recruit classes with ≥3 college seasons of data. Compare against `rating` alone to prove added value.
3. Output: 0–100 projected success score, probability of becoming a contributor / starter / draft pick (draft once imported), position rank, and comparable past recruits (nearest neighbors).

**Metrics:** Spearman rank correlation with outcomes, top-decile hit rate vs. star ratings alone.

**Status (v1, `analytics/recruit_projection.py`):** outcomes from 2023–2025 FBS stats (peak production percentile at position; contributor = peak usage share ≥ 0.20; impact = peak percentile ≥ 0.80). Trained on 2020–2021 classes, validated on 2022 class (2,232 linked recruits, 23.8% impact rate).

| Score | Spearman vs. peak pct | Impact ROC-AUC | Impact rate in top 10% |
|---|---|---|---|
| Rating only | 0.363 | 0.638 | **0.471** |
| Model | 0.411 | 0.663 | 0.422 |
| **Blend (used)** | **0.427** | **0.663** | 0.431 |

Scores are projected as if every recruit joins a typical Power 4 program. OL/LS have no individual stats, so they use rating percentile only. Published to `analytics.recruit_projection`. `p_drafted` (all positions incl. OL) activates once draft picks are imported. Top-decile check: blend weights tuned on the 2021 class gave no reliable gain on the 2022 holdout (0.431 → 0.435 vs. rating-only 0.471), so the equal blend stays; real improvement needs new inputs (draft outcomes, offers, combine data).

### 2c. Portal Acquisition Score

**Goal:** Rank portal (or high-risk) players by expected value to *your* program.

**Pool:** current-cycle `portalplayers` (matched to roster/stats history), plus high transfer-risk players from 2a as "watch list".

**Components:**
- **Player quality:** prior-season production percentile by position from `stats`, adjusted by origin conference and team SP+; CFBD transfer `rating`/`stars`.
- **Positional need (selected team):** departures at the position = class-year seniors + outgoing `portalplayers` (`origin` = team) − incoming recruits/transfers; lost production share.
- **Eligibility remaining:** from `portalplayers.eligibility` and estimated class year.
- **Fit:** distance from home to campus, conference-level step up/down, prior ties (home state = team state).
- **Availability:** `destination` is null = still uncommitted.

**Approach:** Weighted score with weights the user can adjust in the UI. Later: model predicting next-season production at the new school, trained on past transfers (origin stats → destination stats).

**Status:** `analytics.portal_candidate` stores team-independent quality (position-weighted) and eligibility; the web app adds team need (from the pipeline) and fit (conference; + home state once locations are imported) with live weight sliders.

### 2d. Roster Pipeline (team-level rollup)

For a selected team, by position group, for seasons S+1 to S+3:
- **Expected returning value** = Σ player value × (1 − P(leave)), minus players out of eligibility.
- **Incoming value** = committed recruits (projected success) + committed transfers.
- **Gap** = target depth/value per position − (returning + incoming) → flags positions needing recruits or portal additions.
- Drives the positional-need input of 2c and the replaceability input of 2a-iii.

**Status:** `analytics.roster_pipeline` (team × group × 2027–2029).

### 2e. Shared Model Infrastructure

- [x] `analytics.model_run` table (run_id, model_name, version, trained_at, metrics JSON incl. validation + score summaries).
- [x] Score tables: `analytics.recruit_projection`, `analytics.departure_risk`, `analytics.portal_candidate`, `analytics.roster_pipeline`.
- [x] `score.py` CLI rebuilds features → scores → replaces tables (idempotent).
- [x] Unit tests (`analytics/tests`, 8 passing); validation metrics stored per run.

**Exit criteria:** Each model beats its baseline on holdout season; scores written to `analytics` tables.

---

## Phase 3 — Next.js Application

### Setup
- [x] Next.js 16 (App Router, TypeScript, Tailwind) in `web/`.
- [x] UI built with Tailwind components (shadcn/TanStack/Recharts not needed at this size).
- [x] DB access via `pg` with a server-only module (`web/lib/db.ts`): verified TLS with the AWS RDS CA bundle, read-only sessions, parameterized queries, and whitelisted sort columns.
- [x] Env in `web/.env.local` (git-ignored).

### Pages
| Route | Content |
|---|---|
| `/` | Team selector + dashboard: pipeline gaps by position, top retention priorities, top recruits, top portal fits |
| `/pipeline` | Roster pipeline by position group for next 1–3 seasons: returning, at-risk, graduating, incoming, gap |
| `/retention` | Roster with transfer risk, NFL risk, combined departure risk, retention priority, top drivers |
| `/recruits` | 2027 class board: projected success, outcome probabilities, comps, filters by position/state/stars |
| `/portal` | Portal acquisition board with adjustable weight sliders and positional-need filter; watch list of high-risk players elsewhere |
| `/players/[id]` | Player profile: bio, stats by season, score history, driver breakdown, comps |
| `/models` | Model versions, metrics, last run time (transparency) |

### Features
- [x] Server-side filtering, sorting, pagination via URL search params.
- [x] Watchlists / saved boards — star players/recruits on any board; saved per browser (`/watchlist`). A shared, DB-backed watchlist would need a write role for the web app.
- [x] CSV export (`/api/export`, whitelisted tables, formula-injection safe).
- [x] Login gate — `proxy.ts` + signed httpOnly session cookie (HMAC-SHA256, 12h), credentials from `APP_USERNAME`/`APP_PASSWORD`, secret `AUTH_SECRET`; API returns 401 without a session. Local values are in `web/.env.local`.

**Exit criteria:** All pages load from precomputed scores in < 1s with realistic data volume.

---

## Phase 4 — Validation, Deployment, Operations

- [ ] Review top-scored players with a domain expert; tune features/weights. *(user)*
- [x] Indexes on score tables (created by `write_table`).
- [x] Scoring job script `analytics/run_scoring.ps1` (register with Task Scheduler — command in the script header).
- [ ] Deploy web app to **Vercel** — app is ready (CA bundle traced via `outputFileTracingIncludes`, env template `web/.env.example`). Remaining steps are yours: import the repo in Vercel with Root Directory `web`, set the env vars from `.env.example`, and allow Vercel to reach RDS (public access + security group, or a Vercel Secure Compute/static IP).
- [x] Monitoring: job exits non-zero on failure with a log file; score-distribution drift warnings vs. previous run.
- [ ] Retrain models each offseason once new portal/outcome labels are available (advance the `TRAIN_*`/`VALID_*`/`SCORE_*` season constants in `transfer_risk.py` and `recruit_projection.py`, then run `score.py`).

---

## Milestones (sequence)

1. **M1 – Data understood:** Phase 0 complete.
2. **M2 – Baselines live:** Phase 1 + rule-based recruit projection, transfer risk, NFL risk, portal score + basic Next.js tables.
3. **M3 – ML models + pipeline:** Validated ML versions replace baselines (NFL model after draft import); roster pipeline and retention priority in UI.
4. **M4 – Full UI:** Player profiles, team views, portal weight tuning, auth.
5. **M5 – Production:** Scheduled scoring, deployment, monitoring.

---

## Key Risks

- **Label availability:** Transfer risk needs historical portal entries; recruit rating needs college outcomes. Missing labels → stay with weighted baselines.
- **NFL labels:** no draft data in the schema; NFL risk stays rule-based until draft picks are imported. Small positive class even then.
- **Short history:** only 2 roster seasons with transfer labels; loading pre-2024 rosters would substantially improve all models.
- **Player identity matching** across HS/college/portal is often the hardest data task.
- **Leakage:** Only use features known *before* the portal window being predicted.
- **Small samples** at some positions (K, P, LS) — pool or use simpler models.
