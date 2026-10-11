import numpy as np
import pandas as pd
import pytest

from cfbd_import import import_season_stats, prepare_season_stats
from pipeline import player_value
from recruit_projection import blend_score, estimate_nil
from transfer_risk import (BASELINE_FLAGS, baseline_score, build_stat_features, haversine_miles, match_portal,
                           norm_name)


def test_season_stats_snapshot_deduplicates_and_records_freshness(monkeypatch):
    row = {"season": 2026, "playerId": "1", "team": "A", "position": "RB",
           "category": "rushing", "statType": "CAR", "stat": "12"}
    writes = []
    monkeypatch.setattr("cfbd_import.get", lambda *args, **kwargs: [row, row.copy()])
    monkeypatch.setattr("cfbd_import.write_table", lambda frame, table, **kwargs: writes.append((frame, table)))
    import_season_stats(2026)
    import_season_stats(2026)
    assert len(writes) == 2
    for frame, table in writes:
        assert table == "cfbd_player_stats_2026"
        assert len(frame) == 1
        assert frame.stat.iloc[0] == 12
        assert frame.fetched_at.notna().all()


def test_season_stats_rejects_empty_wrong_season_and_conflicting_totals():
    row = {"season": 2026, "playerId": "1", "team": "A", "position": "RB",
           "category": "rushing", "statType": "CAR", "stat": "12"}
    for rows in [[], [{**row, "season": 2025}], [row, {**row, "stat": "13"}]]:
        with pytest.raises(ValueError):
            prepare_season_stats(rows, 2026)


def test_failed_stats_refresh_does_not_publish(monkeypatch):
    monkeypatch.setattr("cfbd_import.get", lambda *args, **kwargs: [])
    monkeypatch.setattr("cfbd_import.write_table", lambda *args, **kwargs: pytest.fail("Must retain snapshot"))
    with pytest.raises(ValueError):
        import_season_stats(2026)


def test_stats_loader_replaces_only_snapshot_season(monkeypatch):
    from transfer_risk import load_stats
    calls = []
    monkeypatch.setattr("transfer_risk.table_exists", lambda name: True)
    monkeypatch.setattr("transfer_risk.query", lambda statement, params: calls.append((statement, params)))
    load_stats()
    statement, params = calls[0]
    assert "season <> %(snapshot_season)s" in statement
    assert "FROM analytics.cfbd_player_stats_2026" in statement
    assert params["has_snapshot"] is True
    assert params["snapshot_season"] == 2026
    calls.clear()
    monkeypatch.setattr("transfer_risk.table_exists", lambda name: False)
    load_stats()
    assert "UNION ALL" not in calls[0][0]
    assert calls[0][1]["has_snapshot"] is False


def test_scoring_stops_before_models_if_refresh_fails(monkeypatch):
    import score
    monkeypatch.setattr("sys.argv", ["score.py", "--refresh-stats"])
    def fail_refresh(year):
        raise ValueError("API unavailable")
    monkeypatch.setattr(score, "import_season_stats", fail_refresh)
    monkeypatch.setattr("transfer_risk.load_data", lambda: pytest.fail("Models must not run"))
    with pytest.raises(ValueError, match="API unavailable"):
        score.main()


def test_returning_nil_forecast_uses_current_role_and_excludes_graduates():
    from nil_value import forecast_returners
    features = pd.DataFrame({
        "athlete_id": [1, 2, 3], "season": [2026] * 3, "team": ["A"] * 3, "group": ["QB"] * 3,
        "rating_pct": [0.5] * 3, "rating": [0.8] * 3, "class_year": [2] * 3,
        "usage_share": [0.8, 0.2, 0.0], "production_pct": [0.9, 0.2, 0.0], "seasons_left_est": [2, 2, 0],
    })
    risk = pd.DataFrame({"athlete_id": [1, 2, 3], "graduating": [0, 0, 1], "leave_prob": [0.2, 0.5, 1.0]})
    pools = pd.DataFrame({"team": ["A", "A"], "season": [2025, 2026], "nil_amt": [1_000_000, 1_100_000]})
    scores = pd.DataFrame({"group": ["QB", "QB"], "season": [2025, 2026], "nil_value": [100_000, 110_000]})
    forecast = forecast_returners(features, risk, scores, pools, 4.5).set_index("athlete_id")
    assert set(forecast.index) == {1, 2}
    assert forecast.forecast_season.eq(2027).all()
    assert forecast.loc[1, "nil_forecast"] > forecast.loc[2, "nil_forecast"]
    assert forecast.loc[1, "expected_returning_nil"] == pytest.approx(forecast.loc[1, "nil_forecast"] * 0.8, abs=50)
    assert forecast.nil_forecast.sum() <= 1_210_000 * 1.05
    features.loc[0, "production_pct"] = 0.1
    lower = forecast_returners(features, risk, scores, pools, 4.5).set_index("athlete_id")
    assert lower.loc[1, "nil_forecast"] < forecast.loc[1, "nil_forecast"]


def test_nil_forecast_rewards_vacated_roles_and_accounts_for_recruits():
    from nil_value import forecast_returners
    features = pd.DataFrame({
        "athlete_id": [1, 2, 3], "season": [2026] * 3, "team": ["A"] * 3, "group": ["QB", "QB", "RB"],
        "rating_pct": [0.8, 0.8, 0.5], "rating": [0.9] * 3, "class_year": [2] * 3,
        "usage_share": [0.9, 0.02, 0.5], "production_pct": [0.9, 0.05, 0.5], "seasons_left_est": [2] * 3,
    })
    risk = pd.DataFrame({"athlete_id": [1, 2, 3], "graduating": [0] * 3, "leave_prob": [0.0] * 3})
    pools = pd.DataFrame({"team": ["A"], "season": [2026], "nil_amt": [1_000_000]})
    scores = pd.DataFrame({"group": ["QB", "RB"], "season": [2026, 2026], "nil_value": [100_000] * 2})
    baseline = forecast_returners(features, risk, scores, pools, 4.5).set_index("athlete_id")
    risk.loc[0, "leave_prob"] = 1.0
    opening = forecast_returners(features, risk, scores, pools, 4.5).set_index("athlete_id")
    assert opening.loc[2, "nil_forecast"] > baseline.loc[2, "nil_forecast"]
    assert opening.loc[2, "projected_usage_share"] > baseline.loc[2, "projected_usage_share"]
    recruits = pd.DataFrame({"committed_to": ["A"] * 3, "group": ["QB"] * 3, "success_score": [90] * 3})
    crowded = forecast_returners(features, risk, scores, pools, 4.5, recruits).set_index("athlete_id")
    assert crowded.loc[2, "opportunity_gain"] < opening.loc[2, "opportunity_gain"]
    assert crowded.loc[2, "nil_forecast"] < opening.loc[2, "nil_forecast"]
    assert opening.projected_usage_share.between(0, 1).all()
    assert "vacated-role gain" in opening.loc[2, "nil_forecast_drivers"]


def test_returning_nil_forecast_caps_trends_and_handles_missing_history():
    from nil_value import forecast_returners
    features = pd.DataFrame({
        "athlete_id": [1, 2], "season": [2026, 2026], "team": ["A", "A"], "group": ["QB", "RB"],
        "rating_pct": [0.5, 0.5], "rating": [0.8, 0.8], "class_year": [2, 2],
        "usage_share": [1.0, 1.0], "production_pct": [0.5, 0.5], "seasons_left_est": [2, 2],
    })
    risk = pd.DataFrame({"athlete_id": [1, 2], "graduating": [0, 0], "leave_prob": [0.0, 0.0]})
    pools = pd.DataFrame({"team": ["A"], "season": [2026], "nil_amt": [1_000_000]})
    scores = pd.DataFrame({"group": ["QB", "RB"], "season": [2026, 2026], "nil_value": [100_000, 100_000]})
    baseline = forecast_returners(features, risk, scores, pools, 4.5).set_index("athlete_id")
    assert baseline.nil_forecast.sum() == pytest.approx(1_050_000, abs=100)
    assert baseline.loc[1, "nil_forecast"] > baseline.loc[2, "nil_forecast"]
    pools = pd.concat([pools, pd.DataFrame({"team": ["A"], "season": [2025], "nil_amt": [100_000]})])
    scores = pd.concat([scores, pd.DataFrame({"group": ["QB", "RB"], "season": [2025, 2025],
                                             "nil_value": [10_000, 100_000]})])
    growing = forecast_returners(features, risk, scores, pools, 4.5).set_index("athlete_id")
    assert growing.nil_forecast.sum() == pytest.approx(1_312_500, abs=100)
    assert growing.loc[1, "nil_forecast"] / growing.loc[2, "nil_forecast"] > baseline.loc[1, "nil_forecast"] / baseline.loc[2, "nil_forecast"]


def test_nil_anchor_inflation_performance_and_low_usage_protection():
    from nil_value import forecast_returners
    features = pd.DataFrame({
        "athlete_id": [1], "season": [2026], "team": ["A"], "group": ["QB"],
        "rating_pct": [0.8], "rating": [0.9], "class_year": [2],
        "usage_share": [0.8], "production_pct": [0.8], "seasons_left_est": [2],
    })
    risk = pd.DataFrame({"athlete_id": [1], "graduating": [0], "leave_prob": [0.2]})
    pools = pd.DataFrame({"team": ["A"], "season": [2026], "nil_amt": [500_000]})
    scores = pd.DataFrame({"athlete_id": [1], "team": ["A"], "group": ["QB"],
                           "season": [2026], "nil_value": [1_000_000], "production": [0.8]})
    baseline = forecast_returners(features, risk, scores, pools, 4.5)
    assert baseline.nil_forecast.iloc[0] == 1_050_000
    assert baseline.expected_returning_nil.iloc[0] == 840_000
    assert baseline.forecast_basis.iloc[0] == "current NIL anchor"
    zero_inflation = forecast_returners(features, risk, scores, pools, 4.5, inflation_rate=0)
    assert zero_inflation.nil_forecast.iloc[0] == 1_000_000
    features.loc[0, "production_pct"] = 0.9
    improved = forecast_returners(features, risk, scores, pools, 4.5)
    assert improved.nil_forecast.iloc[0] > baseline.nil_forecast.iloc[0]
    features.loc[0, "production_pct"] = 0.1
    declined = forecast_returners(features, risk, scores, pools, 4.5)
    assert declined.nil_forecast.iloc[0] < baseline.nil_forecast.iloc[0]
    features.loc[0, "usage_share"] = 0.0
    unproven = forecast_returners(features, risk, scores, pools, 4.5)
    assert unproven.performance_adjustment.iloc[0] == 0
    assert unproven.nil_forecast.iloc[0] == baseline.nil_forecast.iloc[0]
    with pytest.raises(ValueError):
        forecast_returners(features, risk, scores, pools, 4.5, inflation_rate=-0.1)


def test_backup_starter_blend_responds_to_departures_and_competition():
    from nil_value import forecast_returners
    features = pd.DataFrame({
        "athlete_id": [1, 2], "season": [2026] * 2, "team": ["A"] * 2, "group": ["QB"] * 2,
        "rating_pct": [0.8, 0.8], "rating": [0.9] * 2, "class_year": [2] * 2,
        "usage_share": [0.95, 0.05], "production_pct": [0.9, 0.1], "seasons_left_est": [2, 2],
    })
    risk = pd.DataFrame({"athlete_id": [1, 2], "graduating": [0, 0], "leave_prob": [0.0, 0.0]})
    scores = pd.DataFrame({"athlete_id": [1, 2], "team": ["A"] * 2, "group": ["QB"] * 2,
                           "season": [2026] * 2, "nil_value": [2_000_000, 100_000], "production": [0.9, 0.1]})
    pools = pd.DataFrame({"team": ["A"], "season": [2026], "nil_amt": [3_000_000]})
    retained = forecast_returners(features, risk, scores, pools, 4.5).set_index("athlete_id")
    risk.loc[0, "graduating"] = 1
    risk.loc[0, "leave_prob"] = 1.0
    opening = forecast_returners(features, risk, scores, pools, 4.5).set_index("athlete_id")
    assert opening.loc[2, "starting_probability"] > retained.loc[2, "starting_probability"]
    assert opening.loc[2, "nil_forecast"] > opening.loc[2, "backup_nil_estimate"]
    assert opening.loc[2, "nil_forecast"] <= opening.loc[2, "starter_nil_value"]
    recruits = pd.DataFrame({"committed_to": ["A"], "group": ["QB"], "success_score": [95]})
    crowded = forecast_returners(features, risk, scores, pools, 4.5, recruits).set_index("athlete_id")
    assert crowded.loc[2, "starting_probability"] < opening.loc[2, "starting_probability"]
    assert crowded.loc[2, "nil_forecast"] < opening.loc[2, "nil_forecast"]
    assert crowded.starting_probability.between(0, 1).all()


def test_roster_nil_budget_adds_returner_cost_and_recruits():
    from nil_value import forecast_roster_costs
    roster = pd.DataFrame({"team": ["A", "A"], "group": ["QB", "QB"], "horizon": [1, 2],
                           "projected_players": [3, 4], "incoming_recruits": [1, 1]})
    forecasts = pd.DataFrame({"team": ["A"], "group": ["QB"], "expected_returning_nil": [200_000]})
    scores = pd.DataFrame({"team": ["A"], "group": ["QB"], "season": [2026], "nil_value": [100_000]})
    recruits = pd.DataFrame({"committed_to": ["A"], "group": ["QB"], "estimated_nil": [50_000]})
    result = forecast_roster_costs(roster, forecasts, scores, recruits)
    assert result.estimated_nil_cost.tolist() == [250_000, 400_000]
    assert result.expected_returning_nil.iloc[0] == 200_000
    assert pd.isna(result.expected_returning_nil.iloc[1])


def test_norm_name_strips_suffix_and_punctuation():
    assert norm_name("Dwight Phillips Jr.") == "dwight phillips"
    assert norm_name("Au'Tori") == "autori"
    assert norm_name(None) == ""


def test_haversine_known_distance():
    # Athens, GA to Atlanta, GA is roughly 60-65 miles.
    d = haversine_miles(pd.Series([33.95]), pd.Series([-83.38]), pd.Series([33.75]), pd.Series([-84.39]))
    assert 55 < d.iloc[0] < 70


def _stats(rows):
    return pd.DataFrame(rows, columns=["athlete_id", "season", "team", "stat_position", "metric", "value"])


def test_usage_share_and_depth_rank_within_team_group():
    stats = _stats([
        (1, 2025, "A", "RB", "rushing.CAR", 150), (1, 2025, "A", "RB", "receiving.REC", 10),
        (2, 2025, "A", "RB", "rushing.CAR", 40),
        (3, 2025, "B", "RB", "rushing.CAR", 100),
    ])
    sf = build_stat_features(stats).set_index("athlete_id")
    assert sf.loc[1, "usage_share"] == pytest.approx(160 / 200)
    assert sf.loc[2, "usage_share"] == pytest.approx(40 / 200)
    assert sf.loc[3, "usage_share"] == pytest.approx(1.0)
    assert sf.loc[1, "depth_rank"] == 1 and sf.loc[2, "depth_rank"] == 2


def test_build_stat_features_team_filter():
    stats = _stats([(1, 2025, "A", "WR", "receiving.REC", 10), (2, 2025, "FCS", "WR", "receiving.REC", 50)])
    sf = build_stat_features(stats, {"A"})
    assert list(sf.athlete_id) == [1]


def test_match_portal_exact_and_initial():
    roster = pd.DataFrame({
        "athlete_id": [10, 11], "season": [2025, 2025], "team": ["A", "A"], "group": ["QB", "WR"],
        "k_first": ["john", "michael"], "k_last": ["smith", "jones"],
    })
    portal = pd.DataFrame({
        "season": [2026, 2026, 2026], "first_name": ["John", "Mike", "Nobody"],
        "last_name": ["Smith", "Jones", "Here"], "position": ["QB", "WR", "RB"],
        "origin": ["A", "A", "A"], "destination": [None, "B", None], "eligibility": ["Immediate"] * 3,
    })
    departures, arrivals, stats = match_portal(portal, roster)
    got = departures.set_index("portal_row")
    assert got.loc[0, "athlete_id"] == 10 and got.loc[0, "match"] == "exact"
    assert got.loc[1, "athlete_id"] == 11 and got.loc[1, "match"] == "initial"
    assert 2 not in got.index
    assert stats[2026] == {"entries": 3, "matched": 2, "matched_exact": 1}


def test_baseline_score_bounds():
    n = 50
    rng = np.random.default_rng(0)
    f = pd.DataFrame({
        "has_stat_role": rng.integers(0, 2, n), "usage_share": rng.random(n), "usage_change": rng.normal(0, .2, n),
        "stars": rng.integers(2, 6, n), "pedigree_gap": rng.normal(0, .4, n), "new_head_coach": rng.integers(0, 2, n),
        "incoming_recruits": rng.integers(0, 5, n), "incoming_bluechips": rng.integers(0, 2, n),
        "incoming_transfers": rng.integers(0, 4, n), "prior_transfer": rng.integers(0, 2, n),
        "class_year": rng.integers(1, 6, n), "prev_win_pct": rng.random(n),
    })
    points = {k: int(v) for k, v in zip(BASELINE_FLAGS, rng.integers(-5, 10, len(BASELINE_FLAGS)))}
    s = baseline_score(f, points)
    assert s.between(0, 100).all()


def test_blend_score_range_and_order():
    a = pd.Series([0.1, 0.5, 0.9])
    s = blend_score(a, a, a)
    assert s.is_monotonic_increasing and s.between(0, 1).all()


def test_recruit_nil_uses_similar_first_year_peer_and_committed_team_pool():
    recruits = pd.DataFrame({
        "group": ["WR", "WR"], "rating": [0.8, np.nan], "committed_to": ["Target", None],
    })
    features = pd.DataFrame({
        "athlete_id": [1, 2, 3], "season": [2025, 2025, 2025],
        "years_since_hs": [1, 1, 2], "rating": [0.81, 0.99, 0.80],
    })
    nil = pd.DataFrame({
        "athlete_id": [1, 2, 3], "season": [2025, 2025, 2025], "team": ["Peer", "Peer", "Target"],
        "group": ["WR"] * 3, "nil_value": [100_000, 900_000, 700_000],
        "nil_share": [0.01, 0.09, 0.07], "team_nil_pool": [10_000_000] * 3,
    })

    estimate = estimate_nil(recruits, features, nil, neighbors=1)

    assert estimate.estimated_nil.iloc[0] == pytest.approx(100_000)
    assert estimate.estimated_nil.iloc[1] == pytest.approx(500_000)


def test_player_value_falls_back_to_pedigree():
    f = pd.DataFrame({"production_pct": [np.nan, 1.0], "rating_pct": [0.8, 0.0]})
    v = player_value(f)
    assert v.iloc[0] == pytest.approx(0.8)
    assert v.iloc[1] == pytest.approx(0.65)
