"""Transfer risk: probability a rostered FBS player in season S enters the portal before season S+1."""
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from db import query, table_exists

OUTPUT_DIR = Path(__file__).resolve().parent / "output"
FIRST_STATS_SEASON = 2023
VALID_SEASON = 2025
SCORE_SEASON = 2026
POWER4 = {"SEC", "Big Ten", "Big 12", "ACC"}

POS_GROUP = {
    "QB": "QB", "PRO": "QB", "DUAL": "QB",
    "RB": "RB", "FB": "RB", "APB": "RB",
    "WR": "WR", "TE": "TE",
    "OL": "OL", "OT": "OL", "OG": "OL", "G": "OL", "C": "OL", "OC": "OL", "IOL": "OL",
    "DL": "DL", "DT": "DL", "NT": "DL", "DE": "DL", "EDGE": "DL", "SDE": "DL", "WDE": "DL",
    "LB": "LB", "ILB": "LB", "OLB": "LB",
    "DB": "DB", "CB": "DB", "S": "DB", "SAF": "DB",
    "PK": "K", "K": "K", "P": "P", "LS": "LS", "ATH": "ATH",
}
STAT_GROUPS = {"QB", "RB", "WR", "TE", "DL", "LB", "DB", "K", "P"}

# Volume = opportunity (playing-time proxy); production = output quality.
VOLUME = {
    "QB": {"passing.ATT": 1, "rushing.CAR": 1},
    "RB": {"rushing.CAR": 1, "receiving.REC": 1},
    "WR": {"receiving.REC": 1},
    "TE": {"receiving.REC": 1},
    "DL": {"defensive.TOT": 1},
    "LB": {"defensive.TOT": 1},
    "DB": {"defensive.TOT": 1},
    "K": {"kicking.FGA": 1, "kicking.XPA": 1},
    "P": {"punting.NO": 1},
}
_FRONT7 = {"defensive.TOT": 1, "defensive.TFL": 2, "defensive.SACKS": 4, "defensive.QB HUR": 1, "defensive.PD": 2}
PRODUCTION = {
    "QB": {"passing.YDS": 1, "passing.TD": 20, "passing.INT": -20, "rushing.YDS": 1, "rushing.TD": 20},
    "RB": {"rushing.YDS": 1, "rushing.TD": 20, "receiving.YDS": 1, "receiving.TD": 20},
    "WR": {"receiving.YDS": 1, "receiving.TD": 20},
    "TE": {"receiving.YDS": 1, "receiving.TD": 20},
    "DL": _FRONT7,
    "LB": _FRONT7,
    "DB": {"defensive.TOT": 1, "defensive.TFL": 2, "defensive.PD": 3, "interceptions.INT": 6},
    "K": {"kicking.FGM": 3, "kicking.XPM": 1},
    "P": {"punting.YDS": 0.02},
}
METRICS = sorted({m for spec in (VOLUME, PRODUCTION) for w in spec.values() for m in w})

FEATURES = [
    "usage_share", "usage_pct", "depth_rank", "production_pct",
    "prev_usage_share", "usage_change", "prev_production_pct", "has_stat_role",
    "rating", "stars", "is_rated", "rating_pct", "pedigree_gap", "pedigree_rank_in_group",
    "class_year", "years_since_hs", "seasons_left_est", "prior_transfer",
    "group_roster_count", "incoming_recruits", "incoming_bluechips", "incoming_transfers",
    "new_head_coach", "midseason_coach_change", "sp_overall", "sp_change", "prev_win_pct", "power4",
    "height", "weight", "distance_home_mi",
]
GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB", "K", "P", "LS"]
MODEL_FEATURES = FEATURES + [f"grp_{g}" for g in GROUPS]

LABELS = {
    "usage_share": "Share of position-group volume",
    "usage_pct": "Usage percentile at position",
    "depth_rank": "Depth rank on team (by usage)",
    "production_pct": "Production percentile at position",
    "prev_usage_share": "Prior-season usage share",
    "usage_change": "Change in usage share",
    "prev_production_pct": "Prior-season production percentile",
    "rating": "Recruit rating",
    "stars": "Recruit stars",
    "rating_pct": "Recruit rating percentile",
    "pedigree_gap": "Pedigree exceeds role",
    "pedigree_rank_in_group": "Pedigree rank in position room",
    "class_year": "Class year",
    "years_since_hs": "Years since HS",
    "seasons_left_est": "Seasons left (est.)",
    "prior_transfer": "Previously transferred",
    "group_roster_count": "Players in position room",
    "incoming_recruits": "Incoming recruits at position",
    "incoming_bluechips": "Incoming 4-5 star recruits at position",
    "incoming_transfers": "Transfers added at position",
    "new_head_coach": "New head coach",
    "midseason_coach_change": "Mid-season coach change",
    "sp_overall": "Team SP+",
    "sp_change": "Team SP+ change",
    "prev_win_pct": "Prior-season win %",
    "power4": "Power 4 program",
    "distance_home_mi": "Miles from home",
}


def norm_name(s) -> str:
    s = re.sub(r"[^a-z ]", "", str(s or "").lower())
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    return " ".join(s.split())


def haversine_miles(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = (np.radians(pd.to_numeric(x, errors="coerce")) for x in (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 3958.8 * 2 * np.arcsin(np.sqrt(a))


def weighted_sum(df: pd.DataFrame, groups: pd.Series, spec: dict) -> pd.Series:
    out = pd.Series(np.nan, index=df.index)
    for g, weights in spec.items():
        m = groups == g
        out[m] = sum(df.loc[m, k] * w for k, w in weights.items())
    return out


def load_roster() -> pd.DataFrame:
    roster = query("""
        SELECT DISTINCT ON (id, "Season")
               id AS athlete_id, "Season"::int AS season, team,
               "firstName" AS first_name, "lastName" AS last_name, position,
               year AS class_year, height, weight, "recruitIds" AS recruit_id,
               "homeState" AS home_state, "homeLatitude" AS home_lat, "homeLongitude" AS home_lon
        FROM ing.rosters
        WHERE id IS NOT NULL AND "Season" IS NOT NULL
        ORDER BY id, "Season", team
    """)
    if not table_exists("cfbd_roster_history"):
        return roster
    history = query("""
        SELECT DISTINCT ON (athlete_id, season)
               athlete_id, season::int AS season, team, first_name, last_name, position, class_year,
               height, weight, recruit_id, home_state
        FROM analytics.cfbd_roster_history
        WHERE athlete_id IS NOT NULL AND season < (SELECT min("Season") FROM ing.rosters)
          AND team IN (SELECT school FROM ing.teams WHERE classification = 'fbs')
        ORDER BY athlete_id, season, team
    """)
    return pd.concat([history, roster], ignore_index=True)


def train_seasons(seasons) -> list[int]:
    """Labeled seasons that also have same-season stats (stats start in FIRST_STATS_SEASON)."""
    return sorted(int(s) for s in set(seasons) if FIRST_STATS_SEASON <= s < VALID_SEASON)


def load_data() -> dict[str, pd.DataFrame]:
    return {
        "roster": load_roster(),
        "stats": query("""
            SELECT "playerId" AS athlete_id, season, team, max(position) AS stat_position,
                   category || '.' || "statType" AS metric, sum(stat) AS value
            FROM ing.stats
            WHERE "playerId" IS NOT NULL AND category || '.' || "statType" = ANY(%(metrics)s)
            GROUP BY 1, 2, 3, 5
        """, {"metrics": METRICS}),
        "recruits": query("""
            SELECT id AS recruit_id, "athleteId" AS athlete_id, year AS recruit_year,
                   stars, rating, position, "committedTo" AS committed_to
            FROM ing.hsrecruits
        """),
        "portal": query("""
            SELECT season, "firstName" AS first_name, "lastName" AS last_name, position,
                   origin, destination, eligibility, rating, stars, "transferDate" AS transfer_date
            FROM ing.portalplayers
        """),
        "coaches": query("""
            SELECT "team.school" AS team, year AS season, "coach.id" AS coach_id,
                   games, wins, "spOverall" AS sp_overall
            FROM ing.coaches
        """),
        "teams": query("SELECT school AS team, conference FROM ing.teams WHERE classification = 'fbs'"),
        "team_location": (query("SELECT team, state AS team_state, latitude AS team_lat, longitude AS team_lon "
                                "FROM analytics.cfbd_team_location")
                          if table_exists("cfbd_team_location") else None),
    }


def build_stat_features(stats: pd.DataFrame, teams: set[str] | None = None) -> pd.DataFrame:
    if teams is not None:
        stats = stats[stats.team.isin(teams)]
    keys = ["athlete_id", "season", "team"]
    wide = (stats.pivot_table(index=keys, columns="metric", values="value", aggfunc="sum")
            .reindex(columns=METRICS).fillna(0))
    wide = wide.join(stats.groupby(keys).stat_position.max()).reset_index()
    wide["group"] = wide.stat_position.map(POS_GROUP)
    wide = wide[wide.group.isin(STAT_GROUPS)].copy()
    wide["volume"] = weighted_sum(wide, wide.group, VOLUME)
    wide["production"] = weighted_sum(wide, wide.group, PRODUCTION)

    team_keys = ["season", "team", "group"]
    total = wide.groupby(team_keys).volume.transform("sum")
    wide["usage_share"] = np.where(total > 0, wide.volume / total.where(total > 0, 1), 0.0)
    wide["depth_rank"] = wide.groupby(team_keys).volume.rank(ascending=False, method="min")
    wide["production_pct"] = wide.groupby(["season", "group"]).production.rank(pct=True)
    # A player with stats for two teams in one season keeps his larger role.
    best = wide.sort_values("volume", ascending=False).drop_duplicates(["athlete_id", "season"])
    return best[["athlete_id", "season", "usage_share", "depth_rank", "production_pct"]]


def match_portal(portal: pd.DataFrame, roster: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Returns (departures keyed to origin roster season, arrivals keyed to destination season, match stats)."""
    p = portal.copy()
    p["portal_row"] = np.arange(len(p))
    p["group"] = p.position.map(POS_GROUP)
    p["k_first"] = p.first_name.map(norm_name)
    p["k_last"] = p.last_name.map(norm_name)
    p["k_init"] = p.k_first.str[:1]

    r = roster[["athlete_id", "season", "team", "group", "k_first", "k_last"]].copy()
    r["k_init"] = r.k_first.str[:1]
    loose_keys = ["season", "team", "k_last", "k_init", "group"]
    r_loose = r[~r.duplicated(loose_keys, keep=False)]

    def link(side: str, season_offset: int) -> pd.DataFrame:
        q = p.dropna(subset=[side]).assign(r_season=lambda x: x.season + season_offset)
        exact = q.merge(r, left_on=["r_season", side, "k_first", "k_last"],
                        right_on=["season", "team", "k_first", "k_last"], suffixes=("", "_r"))
        exact = exact.drop_duplicates("portal_row").assign(match="exact")
        rest = q[~q.portal_row.isin(exact.portal_row)]
        loose = rest.merge(r_loose, left_on=["r_season", side, "k_last", "k_init", "group"],
                           right_on=loose_keys, suffixes=("", "_r"))
        loose = loose.drop_duplicates("portal_row").assign(match="initial")
        return pd.concat([exact, loose])[["portal_row", "season", "athlete_id", "r_season", "match", "eligibility"]]

    departures = link("origin", -1)
    arrivals = link("destination", 0)

    roster_seasons = set(roster.season)
    eligible = p[(p.season - 1).isin(roster_seasons)]
    stats = {
        int(s): {
            "entries": int((eligible.season == s).sum()),
            "matched": int((departures.season == s).sum()),
            "matched_exact": int(((departures.season == s) & (departures.match == "exact")).sum()),
        }
        for s in sorted(eligible.season.unique())
    }
    return departures, arrivals, stats


def build_features(d: dict[str, pd.DataFrame]) -> tuple[pd.DataFrame, dict]:
    """Returns (one row per rostered player-season, extras: portal matches, team seasons, match stats)."""
    roster = d["roster"].copy()
    roster["group"] = roster.position.map(POS_GROUP)
    roster["k_first"] = roster.first_name.map(norm_name)
    roster["k_last"] = roster.last_name.map(norm_name)
    roster["class_year"] = roster.class_year.where(roster.class_year.between(1, 5))

    # Recruit profile: via roster recruit id, else via recruit's athlete id; keep best rating.
    rec = d["recruits"].copy()
    rec["group"] = rec.position.map(POS_GROUP)
    cols = ["athlete_id", "recruit_year", "stars", "rating"]
    via_roster = (roster[["athlete_id", "recruit_id"]].dropna().astype({"recruit_id": "int64"})
                  .merge(rec.drop(columns="athlete_id"), on="recruit_id"))[cols]
    via_recruit = rec.dropna(subset=["athlete_id"]).astype({"athlete_id": "int64"})[cols]
    recruit_by_athlete = (pd.concat([via_roster, via_recruit])
                          .sort_values("rating", ascending=False, na_position="last")
                          .drop_duplicates("athlete_id"))
    f = roster.drop(columns="recruit_id").merge(recruit_by_athlete, on="athlete_id", how="left")

    f["years_since_hs"] = f.season - f.recruit_year + 1
    f["seasons_left_est"] = np.where(f.years_since_hs.notna(), 5 - f.years_since_hs, 5 - f.class_year)
    f["is_rated"] = f.rating.notna().astype(int)
    f["has_stat_role"] = f.group.isin(STAT_GROUPS).astype(int)

    # Usage and production, current and prior season.
    sf = build_stat_features(d["stats"])
    f = f.merge(sf, on=["athlete_id", "season"], how="left")
    prev = sf.rename(columns={"usage_share": "prev_usage_share", "production_pct": "prev_production_pct"})
    prev = prev.assign(season=prev.season + 1).drop(columns="depth_rank")
    f = f.merge(prev, on=["athlete_id", "season"], how="left")

    team_keys = ["season", "team", "group"]
    f["group_roster_count"] = f.groupby(team_keys).athlete_id.transform("count")
    stat_role = f.has_stat_role == 1
    for c in ["usage_share", "production_pct", "prev_usage_share", "prev_production_pct"]:
        f.loc[stat_role, c] = f.loc[stat_role, c].fillna(0)
        f.loc[~stat_role, c] = np.nan
    f.loc[stat_role, "depth_rank"] = f.loc[stat_role, "depth_rank"].fillna(f.group_roster_count)
    f.loc[~stat_role, "depth_rank"] = np.nan
    f["usage_change"] = f.usage_share - f.prev_usage_share

    f["usage_pct"] = f.groupby(["season", "group"]).usage_share.rank(pct=True)
    f["rating_pct"] = f.rating.fillna(0).groupby([f.season, f.group]).rank(pct=True)
    f["pedigree_gap"] = f.rating_pct - f.usage_pct
    f["pedigree_rank_in_group"] = f.rating.fillna(0).groupby([f.season, f.team, f.group]).rank(
        ascending=False, method="min")

    # Portal history: departures are the label; arrivals mark prior transfers and added competition.
    departures, arrivals, match_stats = match_portal(d["portal"], roster)
    left = departures[["athlete_id", "r_season"]].drop_duplicates().assign(entered_portal=1)
    f = f.merge(left.rename(columns={"r_season": "season"}), on=["athlete_id", "season"], how="left")
    f["entered_portal"] = f.entered_portal.fillna(0).where(f.season < SCORE_SEASON)

    arrived = arrivals.groupby("athlete_id").r_season.min().rename("first_arrival")
    f = f.merge(arrived, on="athlete_id", how="left")
    team_hist = roster.groupby("athlete_id").team.nunique().rename("n_teams")
    first_team = roster.sort_values("season").drop_duplicates("athlete_id").set_index("athlete_id").team
    f["prior_transfer"] = ((f.first_arrival <= f.season)
                           | (f.athlete_id.map(team_hist).gt(1) & (f.team != f.athlete_id.map(first_team)))
                           ).astype(int)

    # Incoming competition at the player's position.
    inc_rec = (rec.dropna(subset=["committed_to"])
               .assign(season=lambda x: x.recruit_year - 1, bluechip=lambda x: (x.stars >= 4).astype(int))
               .groupby(["season", "committed_to", "group"])
               .agg(incoming_recruits=("recruit_id", "count"), incoming_bluechips=("bluechip", "sum"))
               .reset_index().rename(columns={"committed_to": "team"}))
    f = f.merge(inc_rec, on=team_keys, how="left")
    portal = d["portal"].assign(group=lambda x: x.position.map(POS_GROUP))
    inc_tr = (portal.dropna(subset=["destination"]).groupby(["season", "destination", "group"]).size()
              .rename("incoming_transfers").reset_index().rename(columns={"destination": "team"}))
    f = f.merge(inc_tr, on=team_keys, how="left")
    for c in ["incoming_recruits", "incoming_bluechips", "incoming_transfers"]:
        f[c] = f[c].fillna(0)

    # Team context: coaching stability and strength.
    co = (d["coaches"].sort_values("games", ascending=False)
          .groupby(["team", "season"])
          .agg(coach_id=("coach_id", "first"), n_coaches=("coach_id", "nunique"),
               wins=("wins", "sum"), games=("games", "sum"), sp_overall=("sp_overall", "first"))
          .reset_index())
    co["win_pct"] = co.wins / co.games.where(co.games > 0)
    prev_co = co[["team", "season", "coach_id", "win_pct", "sp_overall"]].rename(
        columns={"coach_id": "prev_coach_id", "win_pct": "prev_win_pct", "sp_overall": "prev_sp"})
    co = co.merge(prev_co.assign(season=prev_co.season + 1), on=["team", "season"], how="left")
    co["new_head_coach"] = (co.prev_coach_id.notna() & (co.coach_id != co.prev_coach_id)).astype(int)
    co["midseason_coach_change"] = (co.n_coaches > 1).astype(int)
    co["sp_change"] = co.sp_overall - co.prev_sp
    f = f.merge(co[["team", "season", "new_head_coach", "midseason_coach_change", "sp_overall",
                    "sp_change", "prev_win_pct"]], on=["team", "season"], how="left")

    f = f.merge(d["teams"], on="team", how="left")
    f["power4"] = (f.conference.isin(POWER4) | (f.team == "Notre Dame")).astype(int)
    if d.get("team_location") is not None:
        f = f.merge(d["team_location"].drop_duplicates("team"), on="team", how="left")
        f["distance_home_mi"] = haversine_miles(f.home_lat, f.home_lon, f.team_lat, f.team_lon)
    else:
        f["distance_home_mi"] = np.nan
    for g in GROUPS:
        f[f"grp_{g}"] = (f.group == g).astype(int)

    # Players whose 5-year clock is exhausted are certain departures, not transfer candidates.
    f["out_of_eligibility"] = (f.seasons_left_est <= 0).astype(int)
    extras = {"match_stats": match_stats, "departures": departures, "arrivals": arrivals, "team_season": co}
    return f, extras


BASELINE_FLAGS = {
    "Minimal role (<5% usage)": lambda f: (f.has_stat_role == 1) & (f.usage_share < 0.05),
    "Limited role (5-15% usage)": lambda f: (f.has_stat_role == 1) & f.usage_share.between(0.05, 0.15),
    "Usage dropped >10 pts": lambda f: f.usage_change < -0.10,
    "Blue-chip in limited role": lambda f: (f.stars >= 4) & (f.usage_share.fillna(0) < 0.15),
    "Pedigree exceeds role": lambda f: f.pedigree_gap > 0.3,
    "New head coach": lambda f: f.new_head_coach == 1,
    "Incoming recruit competition": lambda f: (f.incoming_recruits >= 3) | (f.incoming_bluechips >= 1),
    "Incoming transfer competition": lambda f: f.incoming_transfers >= 2,
    "Previously transferred": lambda f: f.prior_transfer == 1,
    "Sophomore/junior": lambda f: f.class_year.isin([2, 3]),
    "Losing team (<40% wins)": lambda f: f.prev_win_pct < 0.4,
    "Senior class year": lambda f: f.class_year >= 4,
}


def baseline_flags(f: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame({k: rule(f).fillna(False).astype(int) for k, rule in BASELINE_FLAGS.items()}, index=f.index)


def fit_baseline_points(train: pd.DataFrame) -> dict[str, int]:
    """Points per flag = logistic coefficient x 10, so the baseline stays a readable checklist."""
    lr = LogisticRegression(max_iter=1000).fit(baseline_flags(train), train.entered_portal)
    return {k: int(round(10 * c)) for k, c in zip(BASELINE_FLAGS, lr.coef_[0])}


def baseline_score(f: pd.DataFrame, points: dict[str, int]) -> pd.Series:
    raw = baseline_flags(f) @ pd.Series(points)
    lo = sum(min(p, 0) for p in points.values())
    hi = sum(max(p, 0) for p in points.values())
    return (100 * (raw - lo) / (hi - lo)).round(1)


def make_logistic():
    return make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(),
                         LogisticRegression(C=0.3, max_iter=2000))


def make_gbm():
    return LGBMClassifier(n_estimators=300, learning_rate=0.03, num_leaves=15, min_child_samples=50,
                          subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0,
                          random_state=42, verbose=-1)


def evaluate(y: pd.Series, score: np.ndarray, is_probability: bool) -> dict:
    top = pd.Series(score).rank(ascending=False, pct=True).values <= 0.10
    out = {
        "roc_auc": round(roc_auc_score(y, score), 4),
        "pr_auc": round(average_precision_score(y, score), 4),
        "precision_top10pct": round(float(y[top].mean()), 4),
        "base_rate": round(float(y.mean()), 4),
    }
    if is_probability:
        out["brier"] = round(brier_score_loss(y, score), 4)
    return out


def contributions(model, X: pd.DataFrame) -> pd.DataFrame:
    """Per-feature contribution to each prediction (log-odds): SHAP for LightGBM, coef x value for logistic."""
    if isinstance(model, LGBMClassifier):
        values = model.predict(X, pred_contrib=True)[:, :-1]
        return pd.DataFrame(values, columns=X.columns, index=X.index)
    prep, clf = model[:-1], model[-1]
    names = prep.get_feature_names_out()
    return pd.DataFrame(prep.transform(X) * clf.coef_[0], columns=names, index=X.index)


def top_drivers(model, X: pd.DataFrame, labels: dict = LABELS, k: int = 3) -> list[str]:
    contrib = contributions(model, X)
    contrib = contrib[[c for c in contrib.columns if c in labels]]
    drivers = []
    for idx, row in contrib.iterrows():
        top = row[row > 0].nlargest(k)
        drivers.append("; ".join(f"{labels[c]} ({X.at[idx, c]:.2f})" for c in top.index))
    return drivers


def run(d: dict | None = None) -> dict:
    f, extras = build_features(d or load_data())
    eligible = f[f.out_of_eligibility == 0]
    train = eligible[eligible.season.isin(train_seasons(eligible.season))]
    valid = eligible[eligible.season == VALID_SEASON]
    labeled = eligible[eligible.season.isin(train_seasons(eligible.season) + [VALID_SEASON])]
    score = eligible[eligible.season == SCORE_SEASON].copy()

    print(f"Transfer risk rows: train={len(train)} valid={len(valid)} score={len(score)}")
    metrics = {"portal_match": extras["match_stats"], "validation": {}}
    points = fit_baseline_points(train)
    metrics["baseline_points"] = points
    metrics["validation"]["baseline"] = evaluate(valid.entered_portal, baseline_score(valid, points).values, False)
    candidates = {"logistic": make_logistic, "gbm": make_gbm}
    for name, make in candidates.items():
        model = make().fit(train[MODEL_FEATURES], train.entered_portal)
        p = model.predict_proba(valid[MODEL_FEATURES])[:, 1]
        metrics["validation"][name] = evaluate(valid.entered_portal, p, True)

    chosen = max(candidates, key=lambda n: metrics["validation"][n]["pr_auc"])
    metrics["chosen_model"] = chosen

    final = candidates[chosen]().fit(labeled[MODEL_FEATURES], labeled.entered_portal)
    points = fit_baseline_points(labeled)
    score["baseline_score"] = baseline_score(score, points)
    score["transfer_prob"] = final.predict_proba(score[MODEL_FEATURES])[:, 1]

    base_rate = labeled.entered_portal.mean()
    score["tier"] = np.select([score.transfer_prob >= 2 * base_rate, score.transfer_prob >= base_rate],
                              ["High", "Medium"], "Low")
    score["transfer_risk"] = (100 * score.transfer_prob).round(1)
    score["top_drivers"] = top_drivers(final, score[MODEL_FEATURES])
    metrics["tier_thresholds"] = {"High": round(2 * base_rate, 4), "Medium": round(base_rate, 4)}
    metrics["tier_counts"] = score.tier.value_counts().to_dict()
    metrics["rows"] = {"train": len(train), "valid": len(valid), "score": len(score)}
    return {"features": f, "scores": score, "metrics": metrics, "extras": extras}


OUT_COLS = ["athlete_id", "first_name", "last_name", "team", "conference", "position", "group",
            "class_year", "seasons_left_est", "transfer_risk", "tier", "baseline_score", "top_drivers",
            "usage_share", "prev_usage_share", "production_pct", "stars", "rating", "new_head_coach",
            "incoming_recruits", "incoming_transfers", "prior_transfer"]


def main() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    print("Loading data...")
    result = run()
    metrics = result["metrics"]
    print(json.dumps(metrics, indent=2))
    out = result["scores"].sort_values("transfer_risk", ascending=False)[OUT_COLS]
    out.to_csv(OUTPUT_DIR / f"transfer_risk_{SCORE_SEASON}.csv", index=False)
    (OUTPUT_DIR / "transfer_risk_metrics.json").write_text(json.dumps(metrics, indent=2))
    print(f"\nWrote {len(out)} scores to {OUTPUT_DIR / f'transfer_risk_{SCORE_SEASON}.csv'}")
    print(out.head(15).to_string(index=False))


if __name__ == "__main__":
    main()
