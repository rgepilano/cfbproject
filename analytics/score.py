"""Run every model and publish results to the analytics schema (and CSVs in analytics/output).

Usage: python score.py [--no-db]
"""
import json
import sys
import uuid
from datetime import datetime, timezone

import pandas as pd

import nfl_risk
import nil_value
import pipeline
import recruit_projection
import transfer_risk
from db import execute, query, table_exists, write_table
from transfer_risk import OUTPUT_DIR, SCORE_SEASON

MODEL_VERSION = "1.0"
DRIFT_TOLERANCE = 0.25


def summarize(s: pd.Series) -> dict:
    return {"mean": round(float(s.mean()), 4), "p90": round(float(s.quantile(0.9)), 4), "n": int(s.notna().sum())}


def drift_warnings(metrics: dict[str, dict]) -> list[str]:
    """Compare this run's score summaries with the previous run's."""
    if not table_exists("model_run"):
        return []
    prev = query("""SELECT DISTINCT ON (model_name) model_name, metrics FROM analytics.model_run
                     ORDER BY model_name, trained_at DESC""")
    out = []
    for _, row in prev.iterrows():
        old = (row.metrics or {}).get("score_summary")
        new = metrics.get(row.model_name, {}).get("score_summary")
        if not old or not new:
            continue
        for k in ("mean", "p90"):
            if old[k] and abs(new[k] - old[k]) / abs(old[k]) > DRIFT_TOLERANCE:
                out.append(f"{row.model_name}: {k} moved {old[k]} -> {new[k]}")
    return out


def data_quality(d: dict, extras: dict) -> pd.DataFrame:
    checks = query("""
        SELECT 'Blank roster rows' AS check_name, count(*) AS value FROM ing.rosters WHERE id IS NULL
        UNION ALL SELECT 'Duplicate roster player-seasons', count(*) FROM (
            SELECT id, "Season" FROM ing.rosters WHERE id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) x
        UNION ALL SELECT 'Roster rows with invalid class year', count(*) FROM ing.rosters
            WHERE id IS NOT NULL AND (year NOT BETWEEN 1 AND 5 OR year IS NULL)
        UNION ALL SELECT 'Recruits with implausible height', count(*) FROM ing.hsrecruits
            WHERE height < 60 OR height > 84
        UNION ALL SELECT 'Roster teams missing from teams table', count(DISTINCT r.team) FROM ing.rosters r
            LEFT JOIN ing.teams t ON t.school = r.team WHERE r.id IS NOT NULL AND t.school IS NULL
        UNION ALL SELECT 'Columns imported as [Record]', count(*) FROM ing.teams WHERE location = '[Record]'
    """)
    for season, s in extras["match_stats"].items():
        checks.loc[len(checks)] = [f"Unmatched portal entries ({season})", s["entries"] - s["matched"]]
    checks["checked_at"] = datetime.now(timezone.utc)
    return checks


def log_model_runs(run_id: str, metrics: dict[str, dict]) -> None:
    execute("""
        CREATE TABLE IF NOT EXISTS analytics.model_run (
            run_id text, model_name text, version text, trained_at timestamptz, metrics jsonb,
            PRIMARY KEY (run_id, model_name))
    """)
    now = datetime.now(timezone.utc)
    for name, m in metrics.items():
        execute("INSERT INTO analytics.model_run VALUES (%(r)s, %(n)s, %(v)s, %(t)s, %(m)s::jsonb)",
                {"r": run_id, "n": name, "v": MODEL_VERSION, "t": now, "m": json.dumps(m, default=str)})


def main() -> None:
    to_db = "--no-db" not in sys.argv
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:6]
    OUTPUT_DIR.mkdir(exist_ok=True)

    print("Loading source data...")
    d = transfer_risk.load_data()
    tr = transfer_risk.run(d)
    f, extras = tr["features"], tr["extras"]
    nfl = nfl_risk.run(f, nfl_risk.load_draft())
    pools = nil_value.load_team_pools()
    nil = nil_value.run(f, extras["arrivals"], d["portal"], pools)
    nil_scores = nil["scores"]
    rp = recruit_projection.run(nil_reference=(f, nil_scores))

    risk = pipeline.departure_risk(f, tr["scores"], nfl["scores"], rp["scores"])
    risk = risk.merge(nil_scores[["athlete_id", "season", "nil_value", "nil_drivers"]],
                      on=["athlete_id", "season"], how="left")
    pipe = pipeline.roster_pipeline(risk, rp["scores"])
    candidates = pipeline.portal_candidates(f, risk, d["portal"], extras["departures"])
    latest_nil = nil_scores.sort_values("season").drop_duplicates("athlete_id", keep="last")
    candidates["nil_value"] = candidates.athlete_id.map(latest_nil.set_index("athlete_id").nil_value)
    dq = data_quality(d, extras)

    metrics = {"transfer_risk": tr["metrics"], "nfl_risk": nfl["metrics"], "recruit_projection": rp["metrics"],
               "nil_value": nil["metrics"]}
    metrics["transfer_risk"]["score_summary"] = summarize(tr["scores"].transfer_prob)
    metrics["nfl_risk"]["score_summary"] = summarize(nfl["scores"].nfl_prob)
    metrics["recruit_projection"]["score_summary"] = summarize(rp["scores"].p_impact)
    metrics["nil_value"]["score_summary"] = summarize(nil_scores[nil_scores.season == SCORE_SEASON].nil_value)
    for name, m in metrics.items():
        (OUTPUT_DIR / f"{name}_metrics.json").write_text(json.dumps(m, indent=2, default=str))
        print(f"\n== {name} ==\n{json.dumps(m, indent=2, default=str)}")

    scored_at = datetime.now(timezone.utc)
    player_cols = ["athlete_id", "season", "team", "conference", "first_name", "last_name", "position", "group",
                   "class_year", "years_since_hs", "seasons_left_est", "out_of_eligibility", "height", "weight",
                   "home_state", "home_lat", "home_lon", "recruit_year", "stars", "rating", "rating_pct",
                   "usage_share", "usage_pct", "depth_rank", "production_pct", "prev_usage_share",
                   "prev_production_pct", "prior_transfer", "entered_portal", "distance_home_mi"]
    risk_cols = ["athlete_id", "season", "team", "conference", "first_name", "last_name", "position", "group",
                 "class_year", "seasons_left_est", "graduating", "player_value", "transfer_prob", "transfer_risk",
                 "transfer_tier", "transfer_baseline", "transfer_drivers", "nfl_prob", "nfl_risk", "nfl_tier",
                 "nfl_drivers", "leave_prob", "leave_risk", "comparable_teammates", "incoming_strong_recruits",
                 "scarcity", "retention_priority", "retention_rank", "usage_share", "production_pct", "stars",
                 "rating", "nil_value", "nil_drivers"]
    recruit_cols = recruit_projection.OUT_COLS + ["athlete_id"]
    portal = d["portal"].reset_index(drop=True).rename_axis("portal_row").reset_index()
    portal = portal.merge(extras["departures"][["portal_row", "athlete_id", "match"]], on="portal_row", how="left")
    portal["transfer_date"] = pd.to_datetime(portal.transfer_date, errors="coerce", utc=True)

    tables = {
        "team": (d["teams"].merge(d["team_location"], on="team", how="left") if d.get("team_location") is not None
                 else d["teams"], [["team"]]),
        "player_season": (f[player_cols], [["athlete_id", "season"], ["season", "team"]]),
        # nil_amt is loaded externally; carry it over because write_table replaces the table.
        "team_season": (extras["team_season"].merge(pools, on=["team", "season"], how="left"), [["team", "season"]]),
        "player_nil": (nil_scores.assign(run_id=run_id, scored_at=scored_at),
                       [["athlete_id", "season"], ["team", "season"]]),
        "portal_entry": (portal, [["season"], ["athlete_id"]]),
        "departure_risk": (risk[risk_cols].assign(run_id=run_id, scored_at=scored_at),
                           [["team"], ["athlete_id"], ["retention_priority"]]),
        "recruit_projection": (rp["scores"].reindex(columns=recruit_cols).assign(
            class_year=rp["metrics"]["score_class"], run_id=run_id, scored_at=scored_at),
            [["committed_to"], ["pos_group"], ["success_score"]]),
        "roster_pipeline": (pipe.assign(run_id=run_id), [["team", "season"]]),
        "portal_candidate": (candidates.assign(run_id=run_id), [["pos_group"], ["quality"]]),
        "data_quality": (dq, None),
    }
    for name, (df, _) in tables.items():
        # "group" is a SQL keyword; publish it as pos_group.
        tables[name] = (df.rename(columns={"group": "pos_group"}), tables[name][1])
        tables[name][0].to_csv(OUTPUT_DIR / f"{name}.csv", index=False)
    if to_db:
        for warning in drift_warnings(metrics):
            print(f"DRIFT WARNING: {warning}")
        for name, (df, idx) in tables.items():
            write_table(df.reset_index(drop=True), name, indexes=idx)
            print(f"wrote analytics.{name}: {len(df)} rows")
        log_model_runs(run_id, metrics)
        print(f"\nRun {run_id} complete (season {SCORE_SEASON}).")


if __name__ == "__main__":
    main()
