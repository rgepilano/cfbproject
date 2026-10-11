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
FORECAST_INFLATION_RATE = 0.05
STARTER_SLOTS = {"QB": 1, "RB": 1, "WR": 3, "TE": 1, "OL": 5, "DL": 4, "LB": 3, "DB": 4,
                 "K": 1, "P": 1, "LS": 1, "ATH": 1}
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


def forecast_returners(f: pd.DataFrame, risk: pd.DataFrame, scores: pd.DataFrame,
                       pools: pd.DataFrame, concentration: float,
                       recruits: pd.DataFrame | None = None,
                       inflation_rate: float = FORECAST_INFLATION_RATE) -> pd.DataFrame:
    if not np.isfinite(inflation_rate) or not 0 <= inflation_rate <= 0.25:
        raise ValueError("Forecast inflation must be between 0 and 25%")
    current = f[f.season == SCORE_SEASON].copy()
    current = current.merge(risk[["athlete_id", "graduating", "leave_prob"]], on="athlete_id", validate="one_to_one")
    history = pools.sort_values(["team", "season"]).copy()
    history["previous_season"] = history.groupby("team").season.shift()
    history["growth"] = history.groupby("team").nil_amt.pct_change(fill_method=None)
    history = history[(history.season - history.previous_season == 1) & np.isfinite(history.growth)]
    budget_growth = history.groupby("team").growth.median().clip(-0.20, 0.25)
    latest = pools.sort_values("season").drop_duplicates("team", keep="last").set_index("team").nil_amt
    market = scores.groupby(["group", "season"]).nil_value.median().reset_index().sort_values(["group", "season"])
    market["previous_season"] = market.groupby("group").season.shift()
    market["growth"] = market.groupby("group").nil_value.pct_change(fill_method=None)
    market = market[(market.season - market.previous_season == 1) & np.isfinite(market.growth)]
    position_growth = (0.5 * market.groupby("group").growth.median()).clip(-0.20, 0.25)
    current["budget_growth"] = current.team.map(budget_growth).fillna(0)
    current["position_growth"] = current.group.map(position_growth).fillna(0)
    current["team_nil_pool"] = current.team.map(latest) * (1 + current.budget_growth)
    current = current[current.team_nil_pool.notna()].copy()
    pedigree = current.rating_pct.where(current.rating.notna(), 0).fillna(0)
    eligible = (current.graduating == 0) & (current.seasons_left_est >= 1)
    room_keys = [current.team, current.group]
    usage = current.usage_share.fillna(0).clip(0, 1)
    departure = current.leave_prob.fillna(0).clip(0, 1).where(eligible, 1)
    vacated = usage * departure
    room_vacated = vacated.groupby(room_keys).transform("sum")
    claim = (0.6 * usage + 0.4 * pedigree + 0.1).where(eligible, 0)
    room_claim = claim.groupby(room_keys).transform("sum")
    incoming_claim = pd.Series(0.0, index=current.index)
    if recruits is not None:
        incoming = recruits.dropna(subset=["committed_to"]).copy()
        incoming["claim"] = 0.3 * incoming.success_score.fillna(0).clip(0, 100) / 100
        competition = incoming.groupby(["committed_to", "group"]).claim.sum()
        incoming_claim = pd.Series(
            [competition.get((team, group), 0.0) for team, group in zip(current.team, current.group)],
            index=current.index)
    denominator = (room_claim - claim + incoming_claim).clip(lower=0) + claim
    current["opportunity_gain"] = ((room_vacated - vacated).clip(lower=0)
                                   * claim / denominator.where(denominator > 0, 1)).clip(0, 1)
    current["projected_usage_share"] = (usage + current.opportunity_gain).clip(0, 1)
    played = current.group.isin(STAT_GROUPS) & (current.projected_usage_share > 0)
    usage_rank = current.projected_usage_share.where(played).groupby(current.group).rank(pct=True)
    projected_playing_time = 0.5 * usage_rank + 0.5 * current.projected_usage_share
    experience = (current.class_year.clip(1, 4) / 3).clip(0, 1).fillna(0)
    proxy = 0.5 * pedigree + 0.5 * experience
    current["production"] = np.where(played, current.production_pct,
                                     np.where(current.group.isin(STAT_GROUPS), UNPROVEN_DISCOUNT * pedigree, proxy))
    confidence = (usage / 0.20).clip(0, 1)
    potential = np.maximum(current.production.fillna(0), UNPROVEN_DISCOUNT * pedigree)
    opportunity_weight = ((1 - confidence) * current.opportunity_gain / 0.20).clip(0, 0.75)
    current["production"] = (current.production.fillna(0) * (1 - opportunity_weight)
                             + potential * opportunity_weight).clip(0, 1)
    current["playing_time"] = np.where(played, projected_playing_time,
                                       np.where(current.group.isin(STAT_GROUPS), UNPROVEN_DISCOUNT * pedigree, proxy))
    current["pedigree"] = pedigree
    current["experience"] = experience
    slots = current.group.map(STARTER_SLOTS).fillna(1)
    role_rank = usage.groupby(room_keys).rank(ascending=False, method="first")
    current["is_backup"] = role_rank > slots
    strength = (0.6 * usage + 0.25 * pedigree + 0.15 * current.production.fillna(0) + 0.05).where(eligible, 0)
    rivals = (strength * (1 - departure)).groupby(room_keys).transform("sum") - strength * (1 - departure)
    current["starting_probability"] = (slots * strength / (strength + rivals + incoming_claim).where(
        strength + rivals + incoming_claim > 0, 1)).clip(0, 1)
    current["starter_nil_value"] = np.nan
    if {"athlete_id", "team"}.issubset(scores.columns):
        reference = current[["athlete_id", "team", "group"]].merge(
            scores[scores.season == SCORE_SEASON][["athlete_id", "team", "nil_value"]],
            on=["athlete_id", "team"], how="left", validate="one_to_one")
        reference["is_starter"] = (role_rank <= slots).to_numpy() & (usage > 0).to_numpy()
        starters = reference[reference.is_starter & (reference.nil_value > 0)]
        position_value = starters.groupby("group").nil_value.median()
        room_value = starters.groupby(["team", "group"]).nil_value.median()
        current["starter_nil_value"] = [room_value.get((team, group), position_value.get(group, np.nan))
                                        for team, group in zip(current.team, current.group)]
    current["value_index"] = sum(WEIGHTS[column] * current[column].fillna(0) for column in WEIGHTS).clip(0, 1)
    current["position_multiplier"] = current.group.map(POSITION_MULTIPLIER).fillna(0.8) * (1 + current.position_growth)
    current["season"] = SCORE_SEASON + 1
    current = allocate(current, concentration)
    current = current[(current.graduating == 0) & (current.seasons_left_est >= 1)].copy()
    if {"athlete_id", "team", "production"}.issubset(scores.columns):
        anchors = scores[scores.season == SCORE_SEASON][["athlete_id", "team", "nil_value", "production"]]
        anchors = anchors.rename(columns={"nil_value": "current_nil_anchor", "production": "anchor_production"})
        current = current.merge(anchors, on=["athlete_id", "team"], how="left", validate="one_to_one")
    else:
        current["current_nil_anchor"] = np.nan
        current["anchor_production"] = np.nan
    confidence = (current.usage_share.fillna(0).clip(0, 1) / 0.20).clip(0, 1)
    current["performance_adjustment"] = (
        0.4 * (current.production - current.anchor_production.fillna(current.production)) * confidence).clip(-0.20, 0.20)
    current["opportunity_adjustment"] = (0.25 * current.opportunity_gain).clip(0, 0.25)
    current["market_adjustment"] = (0.25 * current.budget_growth + 0.25 * current.position_growth).clip(-0.10, 0.10)
    adjustment = (current.performance_adjustment + current.opportunity_adjustment + current.market_adjustment).clip(-0.25, 0.50)
    anchored = current.current_nil_anchor * (1 + inflation_rate) * (1 + adjustment)
    current["forecast_basis"] = np.where(current.current_nil_anchor > 0, "current NIL anchor", "allocation fallback")
    current["inflation_rate"] = inflation_rate
    current["nil_forecast"] = anchored.where(current.current_nil_anchor > 0, current.nil_value * (1 + inflation_rate)).round(-2)
    current["backup_nil_estimate"] = current.nil_forecast
    current["starter_nil_value"] *= (1 + inflation_rate) * (1 + current.market_adjustment)
    starter_target = current.starter_nil_value.fillna(current.nil_forecast).clip(lower=current.nil_forecast)
    blended = ((1 - current.starting_probability) * current.backup_nil_estimate
               + current.starting_probability * starter_target)
    current["nil_forecast"] = blended.where(current.is_backup, current.nil_forecast).round(-2)
    current["return_probability"] = (1 - current.leave_prob).clip(0, 1)
    current["expected_returning_nil"] = (current.nil_forecast * current.return_probability).round(-2)
    current["nil_forecast_drivers"] = current.apply(
        lambda row: f"{row.forecast_basis}; inflation {inflation_rate:.0%}; "
                f"performance adjustment {row.performance_adjustment:+.0%}; opportunity adjustment {row.opportunity_adjustment:+.0%}; "
                f"market adjustment {row.market_adjustment:+.0%}; "
                f"Opportunity-adjusted production {row.production:.0%}; projected playing time {row.playing_time:.0%}; "
                f"usage share {row.usage_share:.0%} -> {row.projected_usage_share:.0%}; "
                f"vacated-role gain {row.opportunity_gain:.0%}; "
                f"starting-role probability {row.starting_probability:.0%} (heuristic); "
                f"starter valuation {row.starter_nil_value:,.0f}; "
                    f"{row.group} position multiplier {row.position_multiplier:.2f}; "
                    f"budget trend {row.budget_growth:+.0%}; position trend {row.position_growth:+.0%}", axis=1)
    return current[["athlete_id", "season", "team", "group", "nil_forecast", "return_probability",
                    "expected_returning_nil", "projected_usage_share", "opportunity_gain",
                    "current_nil_anchor", "inflation_rate", "performance_adjustment", "opportunity_adjustment",
                    "market_adjustment", "forecast_basis", "starting_probability", "starter_nil_value",
                    "backup_nil_estimate", "is_backup",
                    "nil_forecast_drivers"]].rename(columns={"season": "forecast_season"})


def forecast_roster_costs(roster: pd.DataFrame, forecasts: pd.DataFrame, scores: pd.DataFrame,
                          recruits: pd.DataFrame) -> pd.DataFrame:
    keys = ["team", "group"]
    returning = forecasts.groupby(keys).expected_returning_nil.sum().reset_index()
    incoming = (recruits.dropna(subset=["committed_to"]).groupby(["committed_to", "group"])
                .estimated_nil.sum(min_count=1).rename("incoming_nil").reset_index()
                .rename(columns={"committed_to": "team"}))
    current = scores[scores.season == SCORE_SEASON]
    averages = current.groupby(keys).nil_value.mean().rename("avg_nil").reset_index()
    team_average = current.groupby("team").nil_value.mean()
    result = roster.merge(returning, on=keys, how="left").merge(incoming, on=keys, how="left").merge(averages, on=keys, how="left")
    average = result.avg_nil.fillna(result.team.map(team_average))
    baseline = average * result.projected_players
    result["expected_returning_nil"] = result.expected_returning_nil.fillna(0).where(result.horizon == 1)
    result["estimated_nil_cost"] = np.where(
        result.horizon == 1,
        result.expected_returning_nil + result.incoming_nil.fillna(average * result.incoming_recruits), baseline)
    return result.drop(columns=["incoming_nil", "avg_nil"])


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
