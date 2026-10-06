"""Team-level decisions: departure risk + retention priority, roster pipeline, and portal candidates."""
import numpy as np
import pandas as pd

from transfer_risk import POS_GROUP, SCORE_SEASON

HORIZONS = [1, 2, 3]
# Annual attrition assumed for incoming freshmen in later horizons.
RECRUIT_ATTRITION = 0.15
RECRUIT_RAMP = {1: 0.3, 2: 0.6, 3: 0.9}
DEFAULT_PORTAL_WEIGHTS = {"quality": 0.50, "need": 0.25, "eligibility": 0.15, "fit": 0.10}
# Relative roster impact by position group; specialists are valuable but easier to replace.
POSITION_IMPORTANCE = {"QB": 1.0, "RB": 0.8, "WR": 0.85, "TE": 0.75, "OL": 0.85, "DL": 0.9, "LB": 0.8,
                       "DB": 0.85, "K": 0.4, "P": 0.3, "LS": 0.2, "ATH": 0.7}


def player_value(f: pd.DataFrame) -> pd.Series:
    """0-1 value: current performance where measurable, recruit pedigree otherwise."""
    perf = f.production_pct.fillna(f.rating_pct)
    return (0.65 * perf.fillna(0) + 0.35 * f.rating_pct.fillna(0)).clip(0, 1)


def departure_risk(f: pd.DataFrame, transfer: pd.DataFrame, nfl: pd.DataFrame, recruits: pd.DataFrame) -> pd.DataFrame:
    roster = f[f.season == SCORE_SEASON].copy()
    roster["player_value"] = player_value(roster)
    t = transfer[["athlete_id", "transfer_prob", "transfer_risk", "tier", "top_drivers", "baseline_score"]]
    roster = roster.merge(t.rename(columns={"tier": "transfer_tier", "top_drivers": "transfer_drivers",
                                            "baseline_score": "transfer_baseline"}), on="athlete_id", how="left")
    roster = roster.merge(nfl, on="athlete_id", how="left")
    roster["graduating"] = roster.out_of_eligibility
    pt = roster.transfer_prob.fillna(0)
    pn = roster.nfl_prob.fillna(0)
    roster["leave_prob"] = np.where(roster.graduating == 1, 1.0, 1 - (1 - pt) * (1 - pn))
    roster["leave_risk"] = (100 * roster.leave_prob).round(1)

    # Scarcity: fewer comparable teammates and incoming blue-chips at the position = harder to replace.
    keys = ["team", "group"]
    capable = roster[roster.graduating == 0]
    def comparable_count(row_group: pd.DataFrame) -> pd.Series:
        v = row_group.player_value.values
        return pd.Series([(v >= 0.8 * vi).sum() - 1 for vi in v], index=row_group.index)
    roster["comparable_teammates"] = capable.groupby(keys, group_keys=False).apply(comparable_count)
    incoming = (recruits.dropna(subset=["committed_to"])
                .assign(strong=lambda r: (r.success_score >= 80).astype(int))
                .groupby(["committed_to", "group"]).strong.sum().rename("incoming_strong_recruits")
                .reset_index().rename(columns={"committed_to": "team"}))
    roster = roster.merge(incoming, on=keys, how="left")
    roster["incoming_strong_recruits"] = roster.incoming_strong_recruits.fillna(0)
    roster["scarcity"] = 1 / (1 + roster.comparable_teammates.fillna(0) + roster.incoming_strong_recruits)
    roster["retention_priority"] = np.where(
        roster.graduating == 1, 0,
        100 * roster.player_value * roster.group.map(POSITION_IMPORTANCE).fillna(0.7)
        * pt * np.sqrt(roster.scarcity)).round(1)
    roster["retention_rank"] = (roster.groupby("team").retention_priority
                                .rank(ascending=False, method="min").astype(int))
    return roster


def roster_pipeline(risk: pd.DataFrame, recruits: pd.DataFrame) -> pd.DataFrame:
    rows = []
    rec = recruits.dropna(subset=["committed_to"]).rename(columns={"committed_to": "team"})
    rec = rec.assign(rec_value=rec.success_score / 100)
    for k in HORIZONS:
        r = risk.assign(
            stays=lambda x: np.where(x.seasons_left_est.fillna(1) >= k, (1 - x.leave_prob) ** k, 0.0),
            exhausted=lambda x: (x.seasons_left_est.fillna(1) < k).astype(int))
        r = r.assign(stays=np.where(r.graduating == 1, 0.0, r.stays), returning_value=lambda x: x.stays * x.player_value)
        agg = r.groupby(["team", "group"]).agg(
            current_players=("athlete_id", "count"),
            expected_returning=("stays", "sum"),
            returning_value=("returning_value", "sum"),
            departures_eligibility=("exhausted", "sum"),
            at_risk_players=("leave_prob", lambda p: float((p[p < 1]).sum())),
        ).reset_index()
        inc = (rec.assign(v=rec.rec_value * RECRUIT_RAMP[k] * (1 - RECRUIT_ATTRITION) ** (k - 1),
                          n=(1 - RECRUIT_ATTRITION) ** (k - 1))
               .groupby(["team", "group"]).agg(incoming_recruits=("n", "sum"), incoming_value=("v", "sum"))
               .reset_index())
        agg = agg.merge(inc, on=["team", "group"], how="outer").fillna(0)
        agg["season"] = SCORE_SEASON + k
        agg["horizon"] = k
        rows.append(agg)
    p = pd.concat(rows, ignore_index=True)
    p = p[p.team.isin(risk.team.unique()) & p.group.notna()]

    # Targets from current FBS rooms: median headcount, 75th percentile value.
    current = risk.groupby(["team", "group"]).agg(n=("athlete_id", "count"), v=("player_value", "sum")).reset_index()
    targets = current.groupby("group").agg(target_players=("n", "median"),
                                           target_value=("v", lambda v: v.quantile(0.75))).reset_index()
    p = p.merge(targets, on="group", how="left")
    p["projected_players"] = p.expected_returning + p.incoming_recruits
    p["projected_value"] = p.returning_value + p.incoming_value
    p["player_gap"] = (p.target_players - p.projected_players).round(2)
    p["value_gap"] = (p.target_value - p.projected_value).round(3)
    p["need_score"] = (100 * (p.value_gap / p.target_value).clip(0, 1)).round(1)
    num = ["expected_returning", "returning_value", "at_risk_players", "incoming_recruits", "incoming_value",
           "projected_players", "projected_value"]
    p[num] = p[num].round(3)
    return p


def portal_candidates(f: pd.DataFrame, risk: pd.DataFrame, portal: pd.DataFrame,
                      departures: pd.DataFrame) -> pd.DataFrame:
    """Players available or likely available, with team-independent components; need/fit are applied per team."""
    pool_portal = portal.reset_index(drop=True).rename_axis("portal_row").reset_index()
    pool_portal = pool_portal[(pool_portal.season == SCORE_SEASON)
                              & pool_portal.destination.fillna("").eq("")
                              & (pool_portal.eligibility != "Withdrawn")]
    pool_portal = pool_portal.merge(departures[["portal_row", "athlete_id"]], on="portal_row", how="left")
    prior = f[f.season == SCORE_SEASON - 1].copy()
    prior["player_value"] = player_value(prior)
    feat_cols = ["athlete_id", "production_pct", "usage_share", "usage_pct", "rating_pct", "sp_overall",
                 "seasons_left_est", "home_state", "home_lat", "home_lon", "player_value", "class_year"]
    in_portal = pool_portal.merge(prior[feat_cols], on="athlete_id", how="left")
    in_portal = in_portal.assign(
        source="In portal (uncommitted)", group=in_portal.position.map(POS_GROUP),
        team=in_portal.origin, portal_rating=in_portal.rating, portal_stars=in_portal.stars,
        seasons_left_est=in_portal.seasons_left_est - 1)

    watch = risk[(risk.transfer_tier == "High") & (risk.graduating == 0)].copy()
    watch = watch.assign(source="Watch list (high transfer risk)", portal_rating=np.nan, portal_stars=watch.stars,
                         seasons_left_est=watch.seasons_left_est)

    cols = ["source", "athlete_id", "first_name", "last_name", "position", "group", "team", "class_year",
            "production_pct", "usage_share", "usage_pct", "rating_pct", "sp_overall", "seasons_left_est",
            "home_state", "home_lat", "home_lon", "portal_rating", "portal_stars", "player_value"]
    extra = ["transfer_risk"]
    c = pd.concat([in_portal.reindex(columns=cols + extra), watch.reindex(columns=cols + extra)], ignore_index=True)
    c = c.rename(columns={"team": "current_team"})
    c = c[~(c.seasons_left_est <= 0)].reset_index(drop=True)

    sp_pct = c.sp_overall.rank(pct=True)
    portal_pct = c.portal_rating.rank(pct=True)
    pedigree = portal_pct.fillna(c.rating_pct)
    c["quality"] = ((0.45 * c.production_pct.fillna(pedigree) + 0.20 * c.usage_pct.fillna(0.5)
                     + 0.20 * pedigree.fillna(0.5) + 0.15 * sp_pct.fillna(0.5))
                    * c.group.map(POSITION_IMPORTANCE).fillna(0.7)).clip(0, 1).round(3)
    c["eligibility_score"] = (c.seasons_left_est.fillna(1) / 4).clip(0, 1).round(3)
    c["candidate_id"] = np.arange(len(c))
    return c
