"""Recruit success projection: expected college impact for a high school recruit class."""
import json
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.metrics import roc_auc_score
from sklearn.neighbors import NearestNeighbors

from db import query, table_exists
from transfer_risk import METRICS, OUTPUT_DIR, POS_GROUP, POWER4, build_stat_features

# Full seasons with stats; 2026 is in progress.
OUTCOME_SEASONS = (2023, 2025)
TRAIN_CLASSES = [2020, 2021]
VALID_CLASS = 2022
SCORE_CLASS = 2027
CONTRIBUTOR_SHARE = 0.20
IMPACT_PCT = 0.80
# No individual stats exist for these groups, so outcomes can't be measured.
RATING_ONLY_GROUPS = {"OL", "LS"}
RECRUIT_GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB", "K", "P", "LS", "ATH"]

FEATURES = ["stars", "rating", "ranking", "is_rated", "rating_pct", "height", "weight", "height_z",
            "weight_z", "bmi_z", "state_talent", "program_sp", "program_power4"] + [f"grp_{g}" for g in RECRUIT_GROUPS]


def load_data() -> dict[str, pd.DataFrame]:
    return {
        "recruits": query("""
            SELECT id AS recruit_id, "athleteId" AS athlete_id, year AS class_year, name,
                   school AS high_school, city, "stateProvince" AS state,
                   NULLIF(trim("committedTo"), '') AS committed_to, position,
                   height, weight, stars, rating, ranking
            FROM ing.hsrecruits
            WHERE "recruitType" = 'HighSchool'
        """),
        "stats": query("""
            SELECT "playerId" AS athlete_id, season, team, max(position) AS stat_position,
                   category || '.' || "statType" AS metric, sum(stat) AS value
            FROM ing.stats
            WHERE "playerId" IS NOT NULL AND season BETWEEN %(s0)s AND %(s1)s
              AND category || '.' || "statType" = ANY(%(metrics)s)
            GROUP BY 1, 2, 3, 5
        """, {"metrics": METRICS, "s0": OUTCOME_SEASONS[0], "s1": OUTCOME_SEASONS[1]}),
        "coaches": query('SELECT "team.school" AS team, year AS season, "spOverall" AS sp FROM ing.coaches'),
        "teams": query("SELECT school AS team, conference FROM ing.teams WHERE classification = 'fbs'"),
        "draft": (query("SELECT DISTINCT college_athlete_id AS athlete_id FROM analytics.cfbd_draft_pick "
                        "WHERE college_athlete_id IS NOT NULL")
                  if table_exists("cfbd_draft_pick") else None),
    }


def build_outcomes(stats: pd.DataFrame, fbs: set[str]) -> pd.DataFrame:
    sf = build_stat_features(stats, fbs)
    return sf.groupby("athlete_id").agg(
        peak_usage=("usage_share", "max"),
        peak_pct=("production_pct", "max"),
        stat_seasons=("season", "nunique"),
    ).reset_index()


def build_features(d: dict[str, pd.DataFrame]) -> pd.DataFrame:
    r = d["recruits"].copy()
    r["group"] = r.position.map(POS_GROUP)
    r.loc[~r.height.between(60, 84), "height"] = np.nan
    r.loc[~r.weight.between(130, 420), "weight"] = np.nan

    r["is_rated"] = r.rating.notna().astype(int)
    r["rating_pct"] = r.rating.fillna(0).groupby([r.class_year, r.group]).rank(pct=True)
    # Measurables relative to position, across all classes.
    r["bmi"] = 703 * r.weight / r.height ** 2
    for c in ["height", "weight", "bmi"]:
        g = r.groupby("group")[c]
        r[f"{c}_z"] = (r[c] - g.transform("mean")) / g.transform("std")

    # Smoothed average rating of a state's recruits (talent density / competition level).
    rated = r.dropna(subset=["rating"])
    state = rated.groupby("state").rating.agg(["sum", "count"])
    prior, k = rated.rating.mean(), 50
    r["state_talent"] = r.state.map((state["sum"] + prior * k) / (state["count"] + k)).fillna(prior)

    # Program strength = average SP+ over available seasons (coaches data starts 2023).
    teams = d["teams"]
    program = d["coaches"].groupby("team").sp.mean().rename("program_sp").reset_index()
    program = program.merge(teams, on="team", how="left")
    program["program_power4"] = (program.conference.isin(POWER4) | (program.team == "Notre Dame")).astype(int)
    r = r.merge(program[["team", "program_sp", "program_power4"]],
                left_on="committed_to", right_on="team", how="left").drop(columns="team")
    r["program_power4"] = r.program_power4.fillna(0)

    for g in RECRUIT_GROUPS:
        r[f"grp_{g}"] = (r.group == g).astype(int)

    out = build_outcomes(d["stats"], set(teams.team))
    r = r.merge(out, on="athlete_id", how="left")
    linked = r.athlete_id.notna()
    for c in ["peak_usage", "peak_pct", "stat_seasons"]:
        r.loc[linked, c] = r.loc[linked, c].fillna(0)
    r["contributor"] = (r.peak_usage >= CONTRIBUTOR_SHARE).astype(float).where(linked)
    r["impact"] = (r.peak_pct >= IMPACT_PCT).astype(float).where(linked)
    if d.get("draft") is not None:
        r["drafted"] = r.athlete_id.isin(d["draft"].athlete_id).astype(float).where(linked)
    return r


def spearman(a: pd.Series, b: pd.Series) -> float:
    return round(float(a.rank().corr(b.rank())), 4)


def top_decile_hit(y: pd.Series, score: pd.Series) -> float:
    return round(float(y[score.rank(ascending=False, pct=True) <= 0.10].mean()), 4)


def blend_score(pred_peak: pd.Series, rating: pd.Series, p_impact: pd.Series) -> pd.Series:
    """Equal-weight rank blend of projected peak, impact probability, and recruit rating (0-1)."""
    return (pred_peak.rank(pct=True) + p_impact.rank(pct=True) + rating.rank(pct=True)) / 3


def make_reg():
    return HistGradientBoostingRegressor(max_depth=3, learning_rate=0.05, max_iter=250,
                                         min_samples_leaf=40, l2_regularization=1.0, random_state=42)


def make_clf():
    return HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=250,
                                          min_samples_leaf=40, l2_regularization=1.0, random_state=42)


def comparables(train: pd.DataFrame, target: pd.DataFrame, k: int = 3) -> pd.Series:
    cols = ["rating", "height_z", "weight_z"]
    result = pd.Series("", index=target.index)
    for g, tgt in target.groupby("group"):
        pool = train[(train.group == g)].dropna(subset=cols)
        tgt = tgt.dropna(subset=cols)
        if len(pool) < k or tgt.empty:
            continue
        scale = pool[cols].std().replace(0, 1)
        nn = NearestNeighbors(n_neighbors=k).fit(pool[cols] / scale)
        _, idx = nn.kneighbors(tgt[cols] / scale)
        for row_idx, neighbors in zip(tgt.index, idx):
            comps = pool.iloc[neighbors]
            result[row_idx] = "; ".join(
                f"{c['name']} ({int(c.class_year)}, peak pct {c.peak_pct:.2f})" for _, c in comps.iterrows())
    return result


def estimate_nil(scores: pd.DataFrame, player_features: pd.DataFrame, nil_scores: pd.DataFrame,
                 neighbors: int = 20) -> pd.DataFrame:
    """Estimate recruit NIL from similar first-year players' shares of their team pools."""
    out = scores.copy()
    out["estimated_nil"] = np.nan
    if nil_scores.empty:
        return out

    player_cols = player_features[["athlete_id", "season", "years_since_hs", "rating"]]
    peers = nil_scores.merge(player_cols, on=["athlete_id", "season"], how="inner")
    peers = peers[(peers.years_since_hs == 1) & peers.nil_value.notna() & peers.group.notna()]
    if peers.empty:
        return out

    team_pools = (nil_scores.sort_values("season").drop_duplicates("team", keep="last")
                  .set_index("team").team_nil_pool.to_dict())
    for idx, recruit in out.iterrows():
        group_peers = peers[peers.group == recruit.group]
        if group_peers.empty:
            continue
        rated_peers = group_peers.dropna(subset=["rating"])
        if pd.notna(recruit.rating) and not rated_peers.empty:
            group_peers = rated_peers.assign(
                rating_distance=(rated_peers.rating - recruit.rating).abs()
            ).nsmallest(neighbors, "rating_distance")

        pool = team_pools.get(recruit.committed_to)
        shares = group_peers.nil_share.dropna()
        if pool is not None and pd.notna(pool) and not shares.empty:
            out.at[idx, "estimated_nil"] = float(pool) * shares.median()
        else:
            out.at[idx, "estimated_nil"] = group_peers.nil_value.median()
    return out


def run(d: dict | None = None, score_class: int = SCORE_CLASS,
        nil_reference: tuple[pd.DataFrame, pd.DataFrame] | None = None) -> dict:
    r = build_features(d or load_data())

    modelable = r.athlete_id.notna() & r.group.notna() & ~r.group.isin(RATING_ONLY_GROUPS)
    train = r[modelable & r.class_year.isin(TRAIN_CLASSES)]
    valid = r[modelable & (r.class_year == VALID_CLASS)]
    fit_all = r[modelable & r.class_year.isin(TRAIN_CLASSES + [VALID_CLASS])]
    print(f"Recruit projection rows: train={len(train)} valid={len(valid)}")

    reg = make_reg().fit(train[FEATURES], train.peak_pct)
    clf = make_clf().fit(train[FEATURES], train.impact)
    pred = pd.Series(reg.predict(valid[FEATURES]), index=valid.index)
    p_impact = clf.predict_proba(valid[FEATURES])[:, 1]
    rating = valid.rating.fillna(0)
    blend = blend_score(pred, rating, pd.Series(p_impact, index=valid.index))

    metrics = {
        "outcome_definition": {
            "seasons": OUTCOME_SEASONS,
            "peak_pct": "best season production percentile among FBS players at position",
            "contributor": f"peak usage share >= {CONTRIBUTOR_SHARE}",
            "impact": f"peak production percentile >= {IMPACT_PCT}",
        },
        "train_classes": TRAIN_CLASSES,
        "valid_class": VALID_CLASS,
        "valid_rows": len(valid),
        "valid_rates": {"contributor": round(valid.contributor.mean(), 4), "impact": round(valid.impact.mean(), 4)},
        "spearman_peak_pct": {"rating_only": spearman(rating, valid.peak_pct), "model": spearman(pred, valid.peak_pct),
                              "blend": spearman(blend, valid.peak_pct)},
        "impact_roc_auc": {"rating_only": round(roc_auc_score(valid.impact, rating), 4),
                           "model": round(roc_auc_score(valid.impact, p_impact), 4),
                           "blend": round(roc_auc_score(valid.impact, blend), 4)},
        "impact_top_decile_hit": {"rating_only": top_decile_hit(valid.impact, rating),
                                  "model": top_decile_hit(valid.impact, pd.Series(p_impact, index=valid.index)),
                                  "blend": top_decile_hit(valid.impact, blend)},
    }

    # Final models on all labeled classes.
    reg = make_reg().fit(fit_all[FEATURES], fit_all.peak_pct)
    clf_impact = make_clf().fit(fit_all[FEATURES], fit_all.impact)
    clf_contrib = make_clf().fit(fit_all[FEATURES], fit_all.contributor)

    s = r[r.class_year == score_class].copy()
    # Project every recruit as if he joined a typical Power 4 program, so commitments don't skew ratings.
    reference = r.loc[r.program_power4 == 1, "program_sp"].median()
    X = s[FEATURES].assign(program_sp=reference, program_power4=1)
    model_rows = ~s.group.isin(RATING_ONLY_GROUPS)
    s["projected_peak_pct"] = np.where(model_rows, reg.predict(X).clip(0, 1), np.nan)
    s["p_contributor"] = np.where(model_rows, clf_contrib.predict_proba(X)[:, 1], np.nan)
    s["p_impact"] = np.where(model_rows, clf_impact.predict_proba(X)[:, 1], np.nan)
    s["p_drafted"] = np.nan
    if "drafted" in r:
        # Draft outcome covers every position, including OL/LS.
        draft_fit = r[r.athlete_id.notna() & r.group.notna() & r.class_year.isin(TRAIN_CLASSES + [VALID_CLASS])]
        clf_draft = make_clf().fit(draft_fit[FEATURES], draft_fit.drafted)
        s["p_drafted"] = clf_draft.predict_proba(X)[:, 1]
        metrics["draft_rate_train"] = round(float(draft_fit.drafted.mean()), 4)
    m = s[model_rows]
    blended = blend_score(m.projected_peak_pct, m.rating.fillna(0), m.p_impact)
    # Model rows: blend percentile within modeled class; OL/LS: rating percentile within group.
    s["success_score"] = (100 * s.rating_pct).round(1)
    s.loc[model_rows, "success_score"] = (100 * blended.rank(pct=True)).round(1)
    s["basis"] = np.where(model_rows, "model + rating blend", "rating only (no OL/LS stats)")
    s["position_rank"] = s.groupby("group").success_score.rank(ascending=False, method="min").astype(int)
    pct = s.success_score.rank(pct=True, ascending=False)
    s["tier"] = np.select([pct <= 0.05, pct <= 0.20, pct <= 0.50], ["Elite", "High", "Solid"], "Developmental")
    s["comparables"] = comparables(fit_all, s)
    if nil_reference is not None:
        s = estimate_nil(s, *nil_reference)
    else:
        s["estimated_nil"] = np.nan
    metrics["score_class"] = score_class
    metrics["reference_program_sp"] = round(float(reference), 2)
    metrics["tier_counts"] = s.tier.value_counts().to_dict()
    return {"recruits": r, "scores": s, "metrics": metrics}


OUT_COLS = ["recruit_id", "name", "position", "group", "high_school", "city", "state", "committed_to",
            "stars", "rating", "ranking", "height", "weight", "success_score", "tier", "position_rank",
            "p_contributor", "p_impact", "p_drafted", "projected_peak_pct", "estimated_nil", "basis", "comparables"]


def main() -> None:
    score_class = int(sys.argv[1]) if len(sys.argv) > 1 else SCORE_CLASS
    OUTPUT_DIR.mkdir(exist_ok=True)
    print("Loading data...")
    result = run(score_class=score_class)
    metrics = result["metrics"]
    print(json.dumps(metrics, indent=2, default=str))
    out = result["scores"].sort_values("success_score", ascending=False)[OUT_COLS]
    path = OUTPUT_DIR / f"recruit_projection_{score_class}.csv"
    out.to_csv(path, index=False)
    (OUTPUT_DIR / "recruit_projection_metrics.json").write_text(json.dumps(metrics, indent=2, default=str))
    print(f"\nWrote {len(out)} recruits to {path}")
    print(out.head(15).drop(columns=["high_school", "city", "comparables"]).to_string(index=False))


if __name__ == "__main__":
    main()
