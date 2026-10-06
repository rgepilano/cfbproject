"""NFL early-entry risk: probability a draft-eligible player with eligibility left is drafted after season S."""
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from db import query, table_exists
from transfer_risk import GROUPS, SCORE_SEASON, VALID_SEASON, evaluate, top_drivers, train_seasons

# Typical number of early entrants drafted per year; used only to scale the heuristic before draft data exists.
EXPECTED_EARLY_ENTRANTS = 130

FEATURES = ["production_pct", "prev_production_pct", "usage_share", "perf", "rating", "rating_pct", "stars",
            "height_z", "weight_z", "sp_overall", "power4", "years_since_hs", "class_year"] + [f"grp_{g}" for g in GROUPS]
LABELS = {
    "production_pct": "Production percentile",
    "prev_production_pct": "Prior-season production percentile",
    "usage_share": "Usage share",
    "perf": "Performance (production or pedigree)",
    "rating": "Recruit rating",
    "rating_pct": "Recruit rating percentile",
    "stars": "Recruit stars",
    "height_z": "Height for position",
    "weight_z": "Weight for position",
    "sp_overall": "Team SP+",
    "power4": "Power 4 program",
    "years_since_hs": "Years since HS",
}


def load_draft() -> pd.DataFrame | None:
    if not table_exists("cfbd_draft_pick"):
        return None
    return query("SELECT college_athlete_id AS athlete_id, year AS draft_year, round, overall "
                 "FROM analytics.cfbd_draft_pick WHERE college_athlete_id IS NOT NULL")


def prepare(f: pd.DataFrame) -> pd.DataFrame:
    x = f.copy()
    for c in ["height", "weight"]:
        g = x.groupby(["season", "group"])[c]
        x[f"{c}_z"] = (x[c] - g.transform("mean")) / g.transform("std")
    # OL/LS have no production stats, so pedigree stands in for performance.
    x["perf"] = x.production_pct.fillna(x.rating_pct)
    years = x.years_since_hs.fillna(x.class_year)
    x["draft_eligible"] = (years >= 3).astype(int)
    x["eligibility_left"] = (x.seasons_left_est >= 1).astype(int)
    return x


def heuristic(x: pd.DataFrame) -> pd.DataFrame:
    """Rule-based score usable without draft labels."""
    size = x[["height_z", "weight_z"]].mean(axis=1).fillna(0)
    size_pct = size.groupby([x.season, x.group]).rank(pct=True)
    score = 100 * (0.55 * x.perf.fillna(0) + 0.30 * x.rating_pct.fillna(0) + 0.15 * size_pct.fillna(0))
    high = (x.perf >= 0.95) & ((x.stars >= 4) | (size > 1))
    raw = (score / 100) ** 8
    out = pd.DataFrame(index=x.index)
    out["nfl_baseline"] = score.round(1)
    # Scale so each season's expected early entrants matches the historical norm.
    out["nfl_prob_heuristic"] = (raw * EXPECTED_EARLY_ENTRANTS / raw.groupby(x.season).transform("sum")).clip(0, 0.9)
    out["nfl_high_flag"] = high.astype(int)
    return out


def make_model():
    return make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(),
                         LogisticRegression(C=0.1, max_iter=2000, class_weight=None))


def run(f: pd.DataFrame, draft: pd.DataFrame | None = None) -> dict:
    x = prepare(f)
    pop = x[(x.draft_eligible == 1) & (x.eligibility_left == 1) & (x.out_of_eligibility == 0)].copy()
    pop = pop.join(heuristic(pop))
    metrics = {"population": {int(s): int(n) for s, n in pop.season.value_counts().sort_index().items()}}

    score = pop[pop.season == SCORE_SEASON].copy()
    if draft is None or draft.empty:
        metrics["mode"] = "heuristic (import draft picks to train)"
        score["nfl_prob"] = score.nfl_prob_heuristic
        score["nfl_drivers"] = ""
    else:
        drafted = draft.assign(season=draft.draft_year - 1)[["athlete_id", "season"]].drop_duplicates()
        pop = pop.merge(drafted.assign(drafted_early=1), on=["athlete_id", "season"], how="left")
        pop["drafted_early"] = pop.drafted_early.fillna(0)
        train = pop[pop.season.isin(train_seasons(pop.season))]
        valid = pop[pop.season == VALID_SEASON]
        labeled = pop[pop.season.isin(train_seasons(pop.season) + [VALID_SEASON])]
        model = make_model().fit(train[FEATURES], train.drafted_early)
        p = model.predict_proba(valid[FEATURES])[:, 1]
        top50 = pd.Series(p).rank(ascending=False) <= 50
        metrics["mode"] = "logistic regression on draft picks"
        metrics["validation"] = {
            "model": evaluate(valid.drafted_early, p, True) | {
                "precision_top50": round(float(valid.drafted_early.values[top50.values].mean()), 4)},
            "heuristic": evaluate(valid.drafted_early, valid.nfl_baseline.values, False),
        }
        final = make_model().fit(labeled[FEATURES], labeled.drafted_early)
        score = pop[pop.season == SCORE_SEASON].copy()
        score["nfl_prob"] = final.predict_proba(score[FEATURES])[:, 1]
        score["nfl_drivers"] = top_drivers(final, score[FEATURES], LABELS)

    score["nfl_risk"] = (100 * score.nfl_prob).round(1)
    score["nfl_tier"] = np.select([score.nfl_prob >= 0.30, score.nfl_prob >= 0.10], ["High", "Medium"], "Low")
    metrics["expected_early_entrants"] = round(float(score.nfl_prob.sum()), 1)
    metrics["tier_counts"] = score.nfl_tier.value_counts().to_dict()
    cols = ["athlete_id", "nfl_prob", "nfl_risk", "nfl_tier", "nfl_baseline", "nfl_high_flag", "nfl_drivers"]
    return {"scores": score[cols], "metrics": metrics}
