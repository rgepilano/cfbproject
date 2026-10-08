"""Player NIL value: allocate each team's NIL pool (analytics.team_season.nil_amt) across its roster.

Each player gets a 0-1 value index from prior-season production and playing time, recruiting pedigree,
experience and portal activity. Share of the team pool is proportional to
position_multiplier * exp(concentration * value_index); concentration is calibrated against published
player NIL estimates (transfer_risk.cfb_nil_estimates) when available.
"""
import json

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from db import query, table_exists
from transfer_risk import FIRST_STATS_SEASON, OUTPUT_DIR, SCORE_SEASON, STAT_GROUPS, norm_name

# Market premium by position group (RB = 1.0).
POSITION_MULTIPLIER = {"QB": 3.0, "DL": 1.4, "WR": 1.25, "OL": 1.2, "DB": 1.1, "RB": 1.0, "LB": 0.9,
                       "TE": 0.85, "ATH": 0.8, "K": 0.3, "P": 0.25, "LS": 0.15}
WEIGHTS = {"production": 0.35, "playing_time": 0.25, "pedigree": 0.30, "experience": 0.10}
TRANSFER_PREMIUM = 0.10
# Players with no prior-season role are credited a discounted share of their pedigree on the field.
UNPROVEN_DISCOUNT = 0.6
DEFAULT_CONCENTRATION = 5.0
CONCENTRATION_GRID = np.arange(1.0, 15.01, 0.5)

COMPONENT_LABELS = {
    "production": "Prior-year production",
    "playing_time": "Prior-year playing time",
    "pedigree": "Recruit pedigree",
    "experience": "Experience",
    "transfer": "Portal addition",
}

OUT_COLS = ["athlete_id", "season", "team", "conference", "first_name", "last_name", "position", "group",
            "class_year", "team_nil_pool", "nil_value", "nil_share", "nil_rank_team", "value_index",
            "position_multiplier", "production", "playing_time", "pedigree", "experience", "transfer_in",
            "nil_drivers"]


def load_team_pools() -> pd.DataFrame:
    """Team NIL pool per season, preserved across re-scoring because score.py rewrites team_season."""
    has_col = query("""SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'analytics'
                       AND table_name = 'team_season' AND column_name = 'nil_amt') AS ok""").ok.iloc[0]
    if not has_col:
        return pd.DataFrame(columns=["team", "season", "nil_amt"])
    pools = query("SELECT team, season::int AS season, nil_amt FROM analytics.team_season WHERE nil_amt IS NOT NULL")
    return pools.astype({"nil_amt": float})


def load_labels() -> pd.DataFrame | None:
    if not table_exists("cfb_nil_estimates", schema="transfer_risk"):
        return None
    return query("SELECT season, first_name, last_name, team, nil_low, nil_high FROM transfer_risk.cfb_nil_estimates "
                 "WHERE nil_low > 0 AND nil_high > 0")


def build(f: pd.DataFrame, arrivals: pd.DataFrame, portal: pd.DataFrame, pools: pd.DataFrame) -> pd.DataFrame:
    # Prior-season stats only exist from FIRST_STATS_SEASON, so the first scorable season is the one after.
    x = f[f.season > FIRST_STATS_SEASON].merge(pools, on=["team", "season"], how="inner")
    x = x.rename(columns={"nil_amt": "team_nil_pool"})

    pedigree = x.rating_pct.where(x.rating.notna(), 0.0).fillna(0.0)
    years = x.years_since_hs.fillna(x.class_year)
    experience = ((years - 1).clip(0, 3) / 3).fillna(0)

    stat_group = x.group.isin(STAT_GROUPS)
    played = stat_group & (x.prev_usage_share > 0)
    usage_pct = x.prev_usage_share.where(played).groupby([x.season, x.group]).rank(pct=True)
    unproven = UNPROVEN_DISCOUNT * pedigree
    # OL/LS/ATH have no individual stats: blend pedigree and experience as the on-field proxy.
    no_stats = 0.5 * pedigree + 0.5 * experience
    x["production"] = np.select([played, stat_group], [x.prev_production_pct, unproven], no_stats)
    x["playing_time"] = np.select([played, stat_group], [usage_pct, unproven], no_stats)
    x[["production", "playing_time"]] = x[["production", "playing_time"]].fillna(0.0)
    x["pedigree"] = pedigree
    x["experience"] = experience

    # Portal activity: transferred in this season; better-rated portal entrants command more.
    p = portal.reset_index(drop=True).rename_axis("portal_row").reset_index()[["portal_row", "rating"]]
    arr = arrivals.merge(p, on="portal_row", how="left")
    arr["portal_pct"] = arr.groupby("r_season").rating.rank(pct=True)
    arr = (arr.sort_values("portal_pct", ascending=False).drop_duplicates(["athlete_id", "r_season"])
           [["athlete_id", "r_season", "portal_pct"]].rename(columns={"r_season": "season"}))
    x = x.merge(arr, on=["athlete_id", "season"], how="left", indicator=True)
    x["transfer_in"] = (x.pop("_merge") == "both").astype(int)
    x["transfer"] = x.transfer_in * x.portal_pct.fillna(0.5)

    x["value_index"] = (sum(w * x[c] for c, w in WEIGHTS.items()) + TRANSFER_PREMIUM * x.transfer).clip(0, 1)
    x["position_multiplier"] = x.group.map(POSITION_MULTIPLIER).fillna(0.8)
    return x


def allocate(x: pd.DataFrame, concentration: float) -> pd.DataFrame:
    w = x.position_multiplier * np.exp(concentration * x.value_index)
    share = w / w.groupby([x.team, x.season]).transform("sum")
    return x.assign(nil_share=share, nil_value=share * x.team_nil_pool)


def calibrate(x: pd.DataFrame, labels: pd.DataFrame | None) -> tuple[float, dict]:
    if labels is None or labels.empty:
        return DEFAULT_CONCENTRATION, {"calibration": "none (no player NIL estimates available)"}
    lab = labels.assign(k_first=labels.first_name.map(norm_name), k_last=labels.last_name.map(norm_name),
                        nil_mid=np.sqrt(labels.nil_low * labels.nil_high)).drop(columns=["first_name", "last_name"])
    lab["label_row"] = np.arange(len(lab))
    # Pools of 0 can't be allocated; they'd only measure missing pool data.
    pooled = x[x.team_nil_pool > 0]
    keys = ["season", "k_first", "k_last"]
    exact = lab.merge(pooled[keys + ["team", "athlete_id"]], on=keys + ["team"])
    unique = pooled[~pooled.duplicated(keys, keep=False)]
    loose = lab[~lab.label_row.isin(exact.label_row)].merge(unique[keys + ["athlete_id"]], on=keys)
    m = pd.concat([exact, loose], ignore_index=True)
    if len(m) < 20:
        return DEFAULT_CONCENTRATION, {"calibration": f"default (only {len(m)} matched estimates)"}

    def predict(k: float) -> pd.DataFrame:
        return m.merge(allocate(x, k)[["athlete_id", "season", "nil_value"]], on=["athlete_id", "season"])

    def err(k: float) -> float:
        p = predict(k)
        return float(np.mean(np.abs(np.log(p.nil_value.clip(lower=1) / p.nil_mid))))

    errors = {float(k): err(k) for k in CONCENTRATION_GRID}
    best = min(errors, key=errors.get)
    pred = predict(best)
    rho = spearmanr(pred.nil_value, pred.nil_mid).statistic
    ratio = pred.nil_value / pred.nil_mid
    return best, {
        "calibration": "published player estimates (transfer_risk.cfb_nil_estimates)",
        "matched_players": int(len(pred)),
        "label_seasons": sorted(int(s) for s in pred.season.unique()),
        "spearman": round(float(rho), 4),
        "mean_abs_log_error": round(errors[best], 4),
        "within_published_range": round(float(pred.nil_value.between(pred.nil_low, pred.nil_high).mean()), 4),
        "within_2x": round(float(ratio.between(0.5, 2).mean()), 4),
        "median_pred_to_estimate": round(float(ratio.median()), 4),
    }


def drivers(x: pd.DataFrame) -> list[str]:
    contrib = pd.DataFrame({c: WEIGHTS[c] * x[c] for c in WEIGHTS} | {"transfer": TRANSFER_PREMIUM * x.transfer})
    out = []
    for i, row in contrib.iterrows():
        parts = []
        mult = x.at[i, "position_multiplier"]
        if mult >= 1.2:
            parts.append(f"{x.at[i, 'group']} market premium (x{mult:.2f})")
        for c in row[row > 0.05].nlargest(2).index:
            if c == "transfer":
                parts.append(COMPONENT_LABELS[c])
            elif c == "pedigree" and pd.notna(x.at[i, "stars"]):
                parts.append(f"{COMPONENT_LABELS[c]} ({int(x.at[i, 'stars'])}-star, {x.at[i, c]:.0%})")
            else:
                parts.append(f"{COMPONENT_LABELS[c]} ({x.at[i, c]:.0%})")
        out.append("; ".join(parts))
    return out


def run(f: pd.DataFrame, arrivals: pd.DataFrame, portal: pd.DataFrame, pools: pd.DataFrame | None = None) -> dict:
    pools = load_team_pools() if pools is None else pools
    x = build(f, arrivals, portal, pools)
    concentration, metrics = calibrate(x, load_labels())
    x = allocate(x, concentration)
    x["nil_rank_team"] = x.groupby(["team", "season"]).nil_value.rank(ascending=False, method="min").astype(int)
    x["nil_value"] = x.nil_value.round(-2)
    x["nil_drivers"] = drivers(x)
    for c in ["nil_share", "value_index", "production", "playing_time", "pedigree", "experience"]:
        x[c] = x[c].round(4)
    current = x[x.season == SCORE_SEASON]
    metrics |= {
        "concentration": concentration,
        "weights": WEIGHTS,
        "transfer_premium": TRANSFER_PREMIUM,
        "position_multiplier": POSITION_MULTIPLIER,
        "seasons_scored": sorted(int(s) for s in x.season.unique()),
        "rows": int(len(x)),
        "score_season_top10_share": round(float(
            current.groupby("team").nil_share.apply(lambda s: s.nlargest(10).sum()).median()), 4)
        if len(current) else None,
    }
    return {"scores": x[OUT_COLS], "metrics": metrics}


def main() -> None:
    import transfer_risk

    d = transfer_risk.load_data()
    f, extras = transfer_risk.build_features(d)
    result = run(f, extras["arrivals"], d["portal"])
    print(json.dumps(result["metrics"], indent=2, default=str))
    s = result["scores"]
    OUTPUT_DIR.mkdir(exist_ok=True)
    s.to_csv(OUTPUT_DIR / "player_nil.csv", index=False)
    top = s[s.season == SCORE_SEASON].nlargest(20, "nil_value")
    print(top[["first_name", "last_name", "team", "position", "nil_value", "nil_drivers"]].to_string(index=False))


if __name__ == "__main__":
    main()
